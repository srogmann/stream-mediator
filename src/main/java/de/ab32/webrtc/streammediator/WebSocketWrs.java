package de.ab32.webrtc.streammediator;

import java.io.IOException;
import java.io.StringReader;
import java.net.InetSocketAddress;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.Map.Entry;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.json.Json;
import javax.json.JsonNumber;
import javax.json.JsonObject;
import javax.json.JsonObjectBuilder;
import javax.json.JsonReader;
import javax.json.JsonString;
import javax.json.JsonValue;

import org.eclipse.jetty.websocket.api.CloseException;
import org.eclipse.jetty.websocket.api.Session;
import org.eclipse.jetty.websocket.api.annotations.OnWebSocketClose;
import org.eclipse.jetty.websocket.api.annotations.OnWebSocketConnect;
import org.eclipse.jetty.websocket.api.annotations.OnWebSocketError;
import org.eclipse.jetty.websocket.api.annotations.OnWebSocketMessage;
import org.eclipse.jetty.websocket.api.annotations.WebSocket;

import de.ab32.webrtc.streammediator.lang.WrsLanguage;

/**
 * This class manages the mediation between the different users and the server.
 * Every user has its own WebSocket-session.
 */
@WebSocket
public class WebSocketWrs {
	/** Logger */
	private static final Logger LOGGER = Logger.getLogger(WebSocketWrs.class.getName());
	
	/** Pattern zum Erkennen von "/192.168.1.2:1234" und Umwandeln in "/192.[...]:1234" */
	private static final Pattern PATTERN_SOCK_ADR = Pattern.compile("(/?[0-9a-fA-F]*[^0-9a-fA-F]?).*(:[^:]+)");

	/** Pattern Language (alphanumeric) */
	private static final Pattern PATTERN_LANG = Pattern.compile("[a-zA-Z-]{1,10}");

	/** Pattern User-Id (non-whitespace characters) */
	private static final Pattern PATTERN_NAME = Pattern.compile("[^\u0000-\u001f\u0085'\"„“]{1,40}");

	/** statistic-keys */
	private static final String[] STATISTIC_KEYS = { "connect", "close", "error", "message",
			"login", "relogin", "requestCall", "rejectCall", "offer", "answer", "candidate", "dictionary", "leave", "logout" };
	
	/** Map User#Session-Id to WebSocket-Session */	
	private static final ConcurrentMap<String, WrsWebsocketSession> MAP_WEBSOCKET_SESSIONS = new ConcurrentHashMap<String, WrsWebsocketSession>(200);

	/** Map Session-Id to WRS-Session */
	private static final ConcurrentMap<String, WrsSession> MAP_SESSIONS = new ConcurrentHashMap<>(100);
	
	/** Map from message-type to count */
	private static final ConcurrentMap<String, AtomicLong> MAP_STATISTICS = new ConcurrentHashMap<>(5);
	
	/** time of last cleanup */
	private static final AtomicReference<Instant> TS_LAST_CLEANUP = new AtomicReference<>(Instant.now());
	
	/** time of last statistics-dump */
	private static final AtomicReference<Instant> TS_LAST_STATISTICS = new AtomicReference<>(Instant.now());
	
	/** current server-configuration */
	private final WrsConfiguration fConfig = WrsConfiguration.getInstance();

	static {
		LOGGER.info("init statistics");
		for (final String statKey : STATISTIC_KEYS) {
			MAP_STATISTICS.put(statKey, new AtomicLong());
		}
	}
	
	/**
	 * Key and JSON-Value.
	 */
	static class JsonKeyValue {
		private final String fName;
		private final Object fValue;
		JsonKeyValue(final String name, final Object value) {
			fName = name;
			fValue = value;
		}
		public String getName() {
			return fName;
		}
		public Object getValue() {
			return fValue;
		}
	}

	@OnWebSocketClose
	public void onClose(final Session session, final int statusCode, final String reason) {
		updateStatistics("close");
		LOGGER.info(String.format("onClose: session=%s, rc=%d, reason=%s",
				printSession(session),
				Integer.valueOf(statusCode), reason));
	}

	@OnWebSocketError
	public void onError(final Session session, final Throwable t) {
		updateStatistics("error");
		final Throwable eCause = (t != null) ? t.getCause() : null;
		if (t instanceof CloseException && eCause instanceof TimeoutException) {
			LOGGER.info(String.format("WebSocket-Timeout in Session %s: %s",
					printSession(session),
					eCause.getMessage()));
		}
		else if ("org.eclipse.jetty.io.EofException".equals(t.getClass().getName()) && eCause instanceof IOException) {
			LOGGER.info(String.format("ClassLoader.WRS=%s, ClassLoader.EofException=%s",
					getClass().getClassLoader(), t.getClass().getClassLoader()));
			LOGGER.info(String.format("WebSocket-EOF in Session %s: %s",
					printSession(session),
					eCause.getMessage()));
		}
		else {
			LOGGER.log(Level.SEVERE,
					String.format("WebSocketError in Session %s",
							printSession(session)), t);
		}
	}
	
	@OnWebSocketConnect
	public void onConnect(final Session session) {
		updateStatistics("connect");
		LOGGER.info(String.format("onConnect: session=%s", printSession(session)));
		String sessionId = searchFreeSession();
		if (sessionId != null) {
			sendeAntwort(session, "connect", true, "session", sessionId,
					"msg", ct("Anmeldung mit einem Namen oder Pseudonym zusammen mit gemeinsamen Session-Namen."));
			
			// Sets the idle-timeout of the websocket-session.
			long idleTimeoutSecs = fConfig.getWebSocketIdleTimeout().get(ChronoUnit.SECONDS);
			session.setIdleTimeout(idleTimeoutSecs * 1000);
		}
		else {
			sendeAntwort(session, "connect", false, "msg", "Der Server ist derzeitig überlastet. Bitte versuche es später nochmal.");
			session.close();
		}
		doCleanup();
	}

	@OnWebSocketMessage
	public void onMessage(final Session session, final String msg) {
		updateStatistics("message");
		// Bsp.: {"type":"login","name":"SR1"}
		// Bsp.: {"type":"offer","offer":{"type":"offer","sdp":"v=0\r\no=mozilla...THIS_IS_SDPARTA-68.7.0 4645867096550263642 0 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\na=fingerprint:sha-256 6D:E7:B1:53:9C:A1:A0:19:C4:49:3C:8C:7A:27:36:97:33:C4:3F:6F:F4:17:5C:CF:FD:F5:D9:EF:B2:93:E6:51\r\na=ice-options:trickle\r\na=msid-semantic:WMS *\r\n"},"name":"VR1","session":"SR1"}
		//
		// * v=0
		// * o=mozilla...THIS_IS_SDPARTA-68.7.0 4645867096550263642 0 IN IP4 0.0.0.0
		// * s=-
		// * t=0 0
		// * a=fingerprint:sha-256 6D:E7:B1:53:9C:A1:A0:19:C4:49:3C:8C:7A:27:36:97:33:C4:3F:6F:F4:17:5C:CF:FD:F5:D9:EF:B2:93:E6:51
		// * a=ice-options:trickle
		// * a=msid-semantic:WMS *
		//
		// o=<username> <sess-id> <sess-version> <nettype> <addrtype> <unicast-address>
		try {
			if (msg.length() > 16384) {
				throw new IllegalArgumentException("Message too long: " + msg.length());
			}
			final JsonObject json;
			try (final JsonReader reader = Json.createReader(new StringReader(msg))) {
				json = reader.readObject();
			}
			final String type = json.getString("type");
			updateStatistics("type");
			final String name = getJsonName(json, "name");
			if (name == null && !"dictionary".equals(type)) {
				throw new IllegalArgumentException("The necessary attribute 'name' is missing.");
			}
			final String peerName = getJsonName(json, "peer");
			final String sessionId;
			{
				// We want a lower-case session-id.
				final String rawSessionId = getJsonName(json, "session");
				sessionId = (rawSessionId != null) ? rawSessionId.toLowerCase(fConfig.getLocale()) : null;
			}
			final Integer boxType = getJsonInteger(json, "boxType");
			final Integer localNr = getJsonInteger(json, "localNr");
			final Integer peerNr = getJsonInteger(json, "peerNr");
			if (LOGGER.isLoggable(Level.INFO)) {
				LOGGER.info(String.format("onMessage: session=%s, type=%s, session=%s, name=%s, nr=%s, peer=%s, peerNr=%s, boxType=%s",
						printSession(session), type,
						sessionId, getShortName(name), localNr, getShortName(peerName), peerNr,
						boxType));
			}
			if ("login".equals(type)) {
				handleLogin(session, type, name, sessionId, boxType, localNr);
			}
			else if ("relogin".equals(type)) {
				handleRelogin(session, type, name, sessionId);
			}
			else if ("requestCall".equals(type)) {
				final JsonObject nullObj = null;
				handleRouting(session, type, nullObj, name, localNr, peerName, peerNr, sessionId, boxType);
			}
			else if ("rejectCall".equals(type)) {
				final JsonObject nullObj = null;
				handleRouting(session, type, nullObj, name, localNr, peerName, peerNr, sessionId, boxType);
			}
			else if ("offer".equals(type)) {
				final JsonObject offer = json.getJsonObject("offer");
				handleRouting(session, type, offer, name, localNr, peerName, peerNr, sessionId, boxType);
			}
			else if ("answer".equals(type)) {
				final JsonObject answer = json.getJsonObject("answer");
				handleRouting(session, type, answer, name, localNr, peerName, peerNr, sessionId, boxType);
			}
			else if ("candidate".equals(type)) {
				final JsonObject candidate = json.getJsonObject("candidate");
				handleRouting(session, type, candidate, name, localNr, peerName, peerNr, sessionId, boxType);
			}
			else if ("dictionary".equals(type)) {
				final String lang = getJsonName(json, "lang");
				handleSendDictionary(session, type, name, lang, sessionId);
			}
			else if ("leave".equals(type)) {
				final JsonObject nullObj = null;
				handleRouting(session, type, nullObj, name, localNr, peerName, peerNr, sessionId, boxType);
			}
			else if ("logout".equals(type)) {
				handleLogout(session, type, name, sessionId);
			}
			else {
				LOGGER.severe("Unexpected type: " + type);
				sendeAntwort(session, type, false, "msg", ct("Unerwarteter Typ"));
			}
		}
		catch (final IllegalArgumentException e) {
			String msgAnzeige;
			if (msg.length() > 1024) {
				msgAnzeige = msg.substring(0, 1024) + "[...]";
			}
			else {
				msgAnzeige = msg;
			}
			LOGGER.log(Level.SEVERE, String.format("Illegal argument while processing message \"%s\" with length %d",
					msgAnzeige, Integer.valueOf(msg.length())), e);
			sendeAntwort(session, "error", false, "msg", ct("Der Server konnte Argumente des Requests nicht erfolgreich verarbeiten."));
		}
		catch (final Throwable e) {
			String msgAnzeige;
			if (msg.length() > 1024) {
				msgAnzeige = msg.substring(0, 1024) + "[...]";
			}
			else {
				msgAnzeige = msg;
			}
			LOGGER.log(Level.SEVERE, String.format("Exception while processing the message \"%s\" with length %d",
					msgAnzeige, Integer.valueOf(msg.length())), e);
			sendeAntwort(session, "error", false, "msg", ct("Der Server konnte den Request nicht erfolgreich verarbeiten."));
		}
		doCleanup();
		doStatistics();
	}

	/**
	 * Removes old entries.
	 */
	private void doCleanup() {
		try {
			final Instant tsNow = Instant.now();
			final Instant tsMaxCleanfree = tsNow.minus(fConfig.getCleanupInterval());
			// If tsLastUpdate ist before tsMaxCleanfree we should do an clean-up.
			final Instant tsLastUpdate = TS_LAST_CLEANUP.getAndUpdate(tsLast ->
				(tsLast.isBefore(tsMaxCleanfree)) ? tsNow : tsLast);
			if (tsLastUpdate.isBefore(tsMaxCleanfree)) {
				final Instant tsMin = tsNow.minus(fConfig.getMaxAgeWebsocket());

				final Set<String> setKeysToDelete = new HashSet<>();
				for (Entry<String, WrsSession> entry : MAP_SESSIONS.entrySet()) {
					final String key = entry.getKey();
					final Instant tsStart = entry.getValue().getTsStart();
					if (tsStart.isBefore(tsMin)) {
						setKeysToDelete.add(key);
					}
				}

				final Set<String> setKeysWssToDelete = new HashSet<>();
				for (Entry<String, WrsWebsocketSession> entry : MAP_WEBSOCKET_SESSIONS.entrySet()) {
					final String key = entry.getKey();
					final Instant tsStart = entry.getValue().getTsStart();
					if (tsStart.isBefore(tsMin)) {
						setKeysWssToDelete.add(key);
					}
				}

				final DateTimeFormatter dtf = DateTimeFormatter.ISO_LOCAL_DATE_TIME;
				final ZonedDateTime zdtLastUpdate = ZonedDateTime.ofInstant(tsLastUpdate, fConfig.getTimeZone());
				LOGGER.info(String.format("cleanup: #tsLastCleanup=%s, #sessions=%d, #oldSessions=%d, #webSocketSessions=%d, #oldWebSocketSessions=%d",
						dtf.format(zdtLastUpdate),
						Integer.valueOf(MAP_SESSIONS.size()), Integer.valueOf(setKeysToDelete.size()),
						Integer.valueOf(MAP_WEBSOCKET_SESSIONS.size()), Integer.valueOf(setKeysWssToDelete.size())));

				for (String key : setKeysToDelete) {
					MAP_SESSIONS.remove(key);
				}
				for (String key : setKeysWssToDelete) {
					MAP_WEBSOCKET_SESSIONS.remove(key);
				}
			}
		} catch (Exception e) {
			LOGGER.log(Level.SEVERE, String.format("Error while doing clean-up, #sessions=%d",
					MAP_WEBSOCKET_SESSIONS.size()), e);
		}
	}

	/**
	 * Ausgabe einer Statistik.
	 */
	private void doStatistics() {
		final Instant tsNow = Instant.now();
		final Instant tsStatistics = tsNow.minus(fConfig.getStatisticsInterval());
		final Instant tsLastStatistics = TS_LAST_STATISTICS.getAndUpdate(tsLast ->
			(tsLast.isBefore(tsStatistics)) ? tsNow : tsLast);
		if (tsLastStatistics.isBefore(tsStatistics)) {
			for (String key : STATISTIC_KEYS) {
				LOGGER.info(String.format("Count %s: %s", key, MAP_STATISTICS.get(key)));
			}
		}
	}

	/**
	 * Marks a string as translatable by the dictionary.
	 * In future this function may check if the message is a key in the dictionary. 
	 * @param msg message
	 * @return same message
	 */
	private String ct(final String msg) {
		return msg;
	}

	/**
	 * Gives the value of a JSON-attribute of a name or user-id. 
	 * @param json JSON-Object
	 * @param nameName name of name-attribute
	 * @return name or <code>null</code>
	 */
	private String getJsonName(final JsonObject json, String nameName) {
		final String sName;
		if (json.get(nameName) == null) {
			sName = null;
		}
		else {
			final JsonValue jsonValue = json.get(nameName);
			if (jsonValue instanceof JsonString) {
				final JsonString jsonString = (JsonString) jsonValue;
				sName = jsonString.getString().trim();
			}
			else {
				sName = null;
			}
		}
		return sName;
	}

	/**
	 * Gets an integer-value.
	 * @param json JSON-objcect
	 * @param key attribut-name
	 * @return integer-value or <code>null</code>
	 */
	private Integer getJsonInteger(JsonObject json, String key) {
		final JsonValue jsonValue = json.get(key);
		final Integer iValue;
		if (jsonValue == null) {
			iValue = null;
		}
		else if (jsonValue instanceof JsonNumber) {
			JsonNumber number = (JsonNumber) jsonValue;
			iValue = Integer.valueOf(number.intValue());
		}
		else if (jsonValue instanceof JsonString) {
			JsonString sValue = (JsonString) jsonValue;
			iValue = Integer.valueOf(sValue.getString());
		}
		else {
			throw new IllegalArgumentException(String.format("Unexpected integer-value (%s, %s) of key (%s)",
					key, json.getClass(), json));
		}
		return iValue;
	}

	/**
	 * Trim a name to the lenght of at most three characters.
	 * @param name Name
	 * @return gekürzter Name
	 */
	private static String getShortName(String name) {
		final String shortName;
		final int maxLen = 3;
		if (name == null) {
			shortName = "";
		}
		else if (name.length() == 0) {
			shortName = "#BLANK#";
		}
		else if (name.length() <= maxLen) {
			shortName = name;
		}
		else {
			shortName = name.substring(0, maxLen) + '*'; 
		}
		return shortName;
	}

	/**
	 * Looks for a free session-Id.
	 * @return Session-Id
	 */
	private String searchFreeSession() {
		String sessionId = null;
		final int maxTries = 3;
		for (int i = 0; i < maxTries; i++) {
			final int sessionNr = (int) (1 + Math.random() * 16777214);
			sessionId = String.format("%06x", sessionNr);
			final WrsSession wrsSession = new WrsSession(sessionId);
			final WrsSession currSession = MAP_SESSIONS.putIfAbsent(sessionId, wrsSession);
			if (currSession == null) {
				// We found a free session.
				break;
			}
			// The session is in use already.
			sessionId = null;
		}
		if (sessionId == null) {
			LOGGER.severe(String.format("Keine freie Session (#tries=%d, #sessions=%d)",
					Integer.valueOf(maxTries), Integer.valueOf(MAP_SESSIONS.size())));
		}
		return sessionId;
	}

	/**
	 * Gets a websocket-session.
	 * @param sessionId session-id
	 * @param name name of the user
	 * @return websocket-session or <code>null</code>
	 */
	private Session getSession(final String sessionId, final String name) {
		final WrsWebsocketSession wrsSession = getWrsSession(sessionId, name);
		final Session session = (wrsSession != null) ? wrsSession.getSession() : null;
		return session;
	}

	/**
	 * Gets a WRS-session.
	 * @param sessionId session-id
	 * @param name name of the user
	 * @return websocket-session or <code>null</code>
	 */
	private WrsWebsocketSession getWrsSession(final String sessionId, final String name) {
		final String key = (name.toLowerCase(fConfig.getLocale()) + "#" + sessionId);
		final WrsWebsocketSession wrsSession = MAP_WEBSOCKET_SESSIONS.get(key);
		return wrsSession;
	}

	/**
	 * Puts a websocket-session.
	 * @param sessionId session-id
	 * @param name name of the user
	 * @return previous WRS-session or <code>null</code>
	 */
	private WrsWebsocketSession putSession(final String sessionId, final String name, Session session) {
		final String key = (name.toLowerCase(fConfig.getLocale()) + "#" + sessionId);
		final WrsWebsocketSession wrsSession = new WrsWebsocketSession(session);
		final WrsWebsocketSession wrsSessionOld = MAP_WEBSOCKET_SESSIONS.put(key, wrsSession);
		
		MAP_SESSIONS.put(sessionId, new WrsSession(sessionId));

		return wrsSessionOld;
	}

	/**
	 * Removes a websocket-session.
	 * @param sessionId session-id
	 * @param name name of the user
	 * @return removed websocket-session or <code>null</code>
	 */
	private Session removeSession(final String sessionId, final String name) {
		final String key = (name.toLowerCase(fConfig.getLocale()) + "#" + sessionId);
		final WrsWebsocketSession wrsSession = MAP_WEBSOCKET_SESSIONS.remove(key);
		final Session sessionPeer = (wrsSession != null) ? wrsSession.getSession() : null;
		return sessionPeer;
	}

	private void handleLogin(final Session session, final String type,
			final String name, final String sessionId,
			final Integer boxType, final Integer localNr) {
		if (!PATTERN_NAME.matcher(name).matches()) {
			sendeAntwort(session, type, false, "name", name, "msg", ct("Unerwarteter User"));
		}
		else if (!PATTERN_NAME.matcher(sessionId).matches()) {
			sendeAntwort(session, type, false, "name", name, "msg", ct("Unerwartete Session-Id"));
		}
		else {
			final WrsWebsocketSession wrsSessionPrev = putSession(sessionId, name, session);
			if (wrsSessionPrev != null) {
				DateTimeFormatter dtf = DateTimeFormatter.ISO_LOCAL_DATE_TIME;
				ZonedDateTime zdtTsStart = ZonedDateTime.ofInstant(wrsSessionPrev.getTsStart(), fConfig.getTimeZone());
				LOGGER.warning(String.format("Old session of user %s: tsStart=%s",
						getShortName(name), dtf.format(zdtTsStart))); 
			}
			sendeAntwort(session, type, true,
					new JsonKeyValue("msg", ct("Login ok. Die Verbindung mit anderen Usern dieser Session ist nun möglich.")),
					new JsonKeyValue("boxType", boxType),
					new JsonKeyValue("name", name),
					new JsonKeyValue("localNr", localNr));
		}
	}

	private void handleLogout(final Session session, final String type,
			final String user, final String sessionId) {
		if (!PATTERN_NAME.matcher(user).matches()) {
			sendeAntwort(session, type, false, "msg", ct("Unerwarteter User"));
		}
		else {
			final Session removedSession = removeSession(sessionId, user);
			if (removedSession == null) {
				sendeAntwort(session, type, true, "msg", ct("Keine vorhandene Session"));
			}
			else {
				sendeAntwort(session, type, true, "msg", ct("Logout ok"), "name", user);
			}
		}
	}

	private void handleRelogin(final Session session, final String type,
			final String name, final String sessionId) {
		if (!PATTERN_NAME.matcher(name).matches()) {
			sendeAntwort(session, type, false, "name", name, "msg", ct("Unerwarteter User"));
		}
		else if (!PATTERN_NAME.matcher(sessionId).matches()) {
			sendeAntwort(session, type, false, "name", name, "msg", ct("Unerwartete Session-Id"));
		}
		else {
			final WrsWebsocketSession wrsSessionPrev = putSession(sessionId, name, session);
			if (wrsSessionPrev != null) {
				DateTimeFormatter dtf = DateTimeFormatter.ISO_LOCAL_DATE_TIME;
				ZonedDateTime zdtTsStart = ZonedDateTime.ofInstant(wrsSessionPrev.getTsStart(), fConfig.getTimeZone());
				LOGGER.info(String.format("Relogin: New session %s, old session of user %s was %s starting at %s",
						printSession(session), getShortName(name),
						printSession(wrsSessionPrev.getSession()),
						dtf.format(zdtTsStart))); 
			}
			sendeAntwort(session, type, true,
					new JsonKeyValue("msg", ct("Relogin ok. Die Verbindung wurde wieder hergestellt.")),
					new JsonKeyValue("name", name));
		}
	}

	/**
	 * Routes a RTC-object from user to peer.
	 * @param session current session
	 * @param type type of message and object
	 * @param rtcObject RTC-object
	 * @param user local user
	 * @param localNr local video-box-nr
	 * @param peerName peer user
	 * @param peerNr video-box-nr of peer user
	 * @param sessionId session-id
	 */
	private void handleRouting(final Session session, String type, final JsonObject rtcObject, final String user,
			Integer localNr, final String peerName, Integer peerNr, final String sessionId,
			final Integer boxType) {
		if (peerName == null) {
			sendeAntwort(session, type, false, "msg", ct("Name fehlt"));
		}
		else if (user == null) {
			sendeAntwort(session, type, false, "msg", ct("Fehlender User"));
		}
		else if (!PATTERN_NAME.matcher(user).matches()) {
			sendeAntwort(session, type, false, "msg", ct("Unerwarteter User"));
		}
		else if (!PATTERN_NAME.matcher(peerName).matches()) {
			sendeAntwort(session, type, false, "msg", ct("Unerwarteter Peeruser"));
		}
		else {
			final Session sessionPeer = getSession(sessionId, peerName);
			if (sessionPeer == null) {
				sendeAntwort(session, type, false, "msg", ct("handleRouting: Der gewählte Teilnehmer ist in der Session nicht bekannt."));
			}
			else {
				final boolean isRequest = "requestCall".equals(type);
				if (LOGGER.isLoggable(Level.INFO) && isRequest) {
					LOGGER.info(String.format("request: %s@%s -> %s@%s",
							getShortName(user), printSession(session),
							getShortName(peerName), printSession(sessionPeer)));
				}
				final boolean isOk = sendeAntwort(sessionPeer, type, true,
						new JsonKeyValue(type, rtcObject),
						new JsonKeyValue("name", user),
						new JsonKeyValue("localNr", localNr),
						new JsonKeyValue("peer", peerName),
						new JsonKeyValue("peerNr", peerNr),
						new JsonKeyValue("boxType", boxType));
				if (!isOk && isRequest) {
					sendeAntwort(session, type, false, "msg", ct("handleRouting: Teilnehmer konnte nicht erreicht werden."));
				}
			}
		}
	}
	
	/**
	 * Sends a JSON-dictionary if available and sets the current language.
	 * @param session session
	 * @param type type of request
	 * @param name user-name
	 * @param lang language (e.g. "de", "en" or "zh-Hans")
	 */
	private void handleSendDictionary(final Session session, final String type, final String name,
			final String lang, final String sessionId) {
		if (!PATTERN_LANG.matcher(lang).matches()) {
			sendeAntwort(session, type, false, "msg", ct("Unerwartete Sprache"));
		}
		else {
			final WrsLanguage wrsDictionary = WrsLanguage.readDictionary(lang, true);
			if (wrsDictionary == null) {
				sendeAntwort(session, type, false, "msg", "Unsupported language");
			}
			else {
				sendeAntwort(session, type, true, "lang", wrsDictionary.getLang(), "dictionary", wrsDictionary.getJsonDictionary());
			}
		}
	}

	/**
	 * Sendet eine Antwort.
	 * @param session WebSocket-Session
	 * @param type Nachrichtentyp
	 * @param isSuccess Erfolgsflag
	 * @param attrName Attributname
	 * @param attrWert Attributwert
	 * @return <code>true</code> im Erfolgsfall, <code>false</code> im Fehlerfall
	 */
	private boolean sendeAntwort(final Session session, String type, final boolean isSuccess,
			final String attrName, final String attrWert) {
		boolean isOk = false;
		if (LOGGER.isLoggable(Level.INFO)) {
			LOGGER.info(String.format("sendeAntwort: session=%s, type=%s, isSuccess=%s, %s=%s",
					printSession(session), type, Boolean.toString(isSuccess),
					attrName, getShortName(attrWert)));
		}
		try {
			final JsonObjectBuilder builder = Json.createObjectBuilder();
			final JsonObject json = builder.add("type", type)
				.add("success", Boolean.valueOf(isSuccess))
				.add(attrName, attrWert)
				.build();
			final String sJson = json.toString();
			session.getRemote().sendStringByFuture(sJson);
			if (LOGGER.isLoggable(Level.FINE)) {
				LOGGER.fine(String.format("Sende Antwort in %s: %s",
						printSession(session), sJson));
			}
			isOk = true;
		}
		catch (Throwable e) {
			LOGGER.log(Level.SEVERE, "Error while sending a response to " + printSession(session), e);
		}
		return isOk;
	}

	/**
	 * Sendet eine Antwort.
	 * @param session WebSocket-Session
	 * @param type Nachrichtentyp
	 * @param isSuccess Erfolgsflag
	 * @param keyValues Key-Value-Liste
	 * @return <code>true</code> im Erfolgsfall, <code>false</code> im Fehlerfall
	 */
	private boolean sendeAntwort(final Session session, String type, final boolean isSuccess,
			final JsonKeyValue... keyValues) {
		boolean isOk = false;
		if (LOGGER.isLoggable(Level.INFO)) {
			LOGGER.info(String.format("sendeAntwort: session=%s, type=%s, isSuccess=%s",
					printSession(session), type, Boolean.toString(isSuccess)));
		}
		try {
			final JsonObjectBuilder builder = Json.createObjectBuilder();
			builder.add("type", type)
				.add("success", Boolean.valueOf(isSuccess));
			for (JsonKeyValue keyValue : keyValues) {
				String name = keyValue.getName();
				final Object value = keyValue.getValue();
				if (value instanceof JsonValue) {
					final JsonValue jsonValue = (JsonValue) value;
					builder.add(name, jsonValue);
				}
				else if (value instanceof Integer) {
					final int iValue = ((Integer) value).intValue();
					builder.add(name, iValue);
				}
				else if (value != null) {
					builder.add(name, value.toString());
				}
			}
			final JsonObject json = builder.build();
			final String sJson = json.toString();
			session.getRemote().sendStringByFuture(sJson);
			if (LOGGER.isLoggable(Level.FINE)) {
				LOGGER.fine(String.format("Send response %s: %s",
						printSession(session), sJson));
			}
			isOk = true;
		}
		catch (Throwable e) {
			LOGGER.log(Level.SEVERE, "Error while sending a response in " + printSession(session), e);
		}
		return isOk;
	}

	/**
	 * Sends a response.
	 * @param session WebSocket-session
	 * @param type type of message
	 * @param isSuccess success-flag
	 * @param attrName name of attribute
	 * @param attrWert value of attribute
	 * @param attr2Name name of second attribute
	 * @param attr2Wert value of second attribute
	 * @return <code>true</code> if successful, <code>false</code> if unsuccessful
	 */
	private boolean sendeAntwort(final Session session, String type, final boolean isSuccess,
			final String attrName, final String attrWert,
			final String attr2Name, final String attr2Wert) {
		boolean isOk = false;
		if (LOGGER.isLoggable(Level.INFO)) {
			LOGGER.info(String.format("sendeAntwort: session=%s, type=%s, isSuccess=%s, %s=%s",
					printSession(session), type, Boolean.toString(isSuccess),
					attrName, getShortName(attrWert)));
		}
		try {
			final JsonObjectBuilder builder = Json.createObjectBuilder();
			final JsonObject json = builder.add("type", type)
				.add("success", Boolean.valueOf(isSuccess))
				.add(attrName, attrWert)
				.add(attr2Name, attr2Wert)
				.build();
			final String sJson = json.toString();
			session.getRemote().sendStringByFuture(sJson);
			if (LOGGER.isLoggable(Level.FINE)) {
				LOGGER.fine(String.format("Send response in session %s: %s",
						printSession(session), sJson));
			}
			isOk = true;
		}
		catch (Throwable e) {
			// Beispielsweise kam eine NullPointerException aus dem ZipDeflater wegen einer geschlossenen WebSocket-Verbindung vor.
			LOGGER.log(Level.SEVERE, "Error while sending response in session " + printSession(session), e);
		}
		return isOk;
	}

	/**
	 * Increments a statistics-field.
	 * @param key key of the field
	 */
	private void updateStatistics(final String key) {
		if (key != null) {
			final AtomicLong counter = MAP_STATISTICS.get(key);
			if (counter != null) {
				counter.incrementAndGet();
			}
		}
	}
	
	/**
	 * Prints local and short-address of a remote-session.
	 * @param session websocket-session
	 * @return display-string
	 */
	private static String printSession(Session session) {
		final StringBuilder sb = new StringBuilder(25);
		sb.append(shortAddress(session.getRemoteAddress()));
		return sb.toString();
	}

    /**
     * Trims an ip-address.
     * @param isa ip-address
     * @return trimmed address
     */
    private static String shortAddress(final InetSocketAddress isa) {
    	final String socketAddress = isa.toString();
    	final Matcher m = PATTERN_SOCK_ADR.matcher(socketAddress);
    	final String shortIsa;
    	if (m.matches()) {
    		final StringBuilder sb = new StringBuilder(socketAddress.length());
    		sb.append(m.group(1)).append("[...]").append(m.group(2));
    		shortIsa = sb.toString();
    	}
    	else {
    		shortIsa = "[...]:" + isa.getPort();
    	}
    	return shortIsa;
    }
    
}
