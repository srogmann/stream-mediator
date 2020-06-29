package de.ab32.webrtc.streammediator;

import java.time.Instant;

import org.eclipse.jetty.websocket.api.Session;

/**
 * Start-time and websocket-session.
 */
public class WrsWebsocketSession {

	/** start-time of the session */
	private final Instant fTsStart;

	/** websocket-session */
	private final Session fSession;

	/**
	 * Constructor
	 * @param fSession
	 */
	public WrsWebsocketSession(Session fSession) {
		this.fTsStart = Instant.now();
		this.fSession = fSession;
	}

	/**
	 * Gets the start-time.
	 * @return start-time
	 */
	public Instant getTsStart() {
		return fTsStart;
	}
	
	/**
	 * Gets the websocket-session.
	 * @return websocket-session
	 */
	public Session getSession() {
		return fSession;
	}

}
