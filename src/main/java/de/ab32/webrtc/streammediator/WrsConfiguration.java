package de.ab32.webrtc.streammediator;

import java.time.Duration;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAmount;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicReference;

/**
 * property-based configuration of the WebRTCServer.
 */
public class WrsConfiguration {
	
	/** Name of the optional property declaring the cleanup-interval as ISO-8601-duration */
	private static final String PROP_CLEANUP_INTERVAL = "wrs.cleanup_interval";
	/** Name of the optional property declaring the maximal of of a websocket-connection as ISO-8601-duration */
	private static final String PROP_MAX_AGE_WEBSOCKET = "wrs.max_age";
	/** Name of the optional property declaring the interval of statistics-dumps as ISO-8601-duration */
	private static final String PROP_STATISTICS_INTERVAL = "wrs.statistics_interval";
	/** Name of the optional property declaring the idle-timeout of a websocket-session */
	private static final String PROP_WEBSOCKET_IDLE_TIMEOUT = "wrs.websocket_idle_timeout";
	/** Name of the optional property declaring the locale as in ISO 639 */	
	private static final String PROP_LOCALE = "wrs.locale";
	/** Name of the optional property declaring the servers' time-zone */ 
	private static final String PROP_TIME_ZONE = "wrs.time_zone";

	/** starting-interval of the cleanup-task (default is 10 minutes) */
	private final TemporalAmount fCleanupInterval = getDuration(PROP_CLEANUP_INTERVAL, Duration.of(10, ChronoUnit.MINUTES));
	/** max age of a websocket-session (default is 6 hours) */
	private final TemporalAmount fMaxAgeWebsocket = getDuration(PROP_MAX_AGE_WEBSOCKET, Duration.of(6, ChronoUnit.HOURS));
	/** statistics (default every hour) */
	private final TemporalAmount fStatisticsInterval = getDuration(PROP_STATISTICS_INTERVAL, Duration.of(1, ChronoUnit.HOURS));
	/** idle-timeout of web-socket-sessions (default is 30 minutes) */
	private final TemporalAmount fWebSocketIdleTimeout = getDuration(PROP_WEBSOCKET_IDLE_TIMEOUT, Duration.of(30, ChronoUnit.MINUTES));
	/** locale used to bring strings into lower-case */
	private final Locale fLocale = getLocale(PROP_LOCALE, Locale.GERMAN);
	/** local time-zone (default is Europe/Berlins) */
	private final ZoneId fTimeZone = ZoneId.of(getString(PROP_TIME_ZONE, "Europe/Berlin"));

	/** current configuration */
	private static final AtomicReference<WrsConfiguration> CONFIG = new AtomicReference<WrsConfiguration>(new WrsConfiguration());
	
	/**
	 * Gets the current server-configuraton.
	 * @return configuration
	 */
	public static WrsConfiguration getInstance() {
		final WrsConfiguration config;
		try {
			config = CONFIG.get();
		}
		catch (Exception e) {
			throw new IllegalArgumentException("The server-configuration couldn't be built. Check the system-properties.", e);
		}
		return config;
	}
	
	/**
	 * Gets the cleanup-interval.
	 * @return duration of interval
	 */
	public TemporalAmount getCleanupInterval() {
		return fCleanupInterval;
	}

	/**
	 * Gets the max age of a websocket-connection.
	 * @return max age
	 */
	public TemporalAmount getMaxAgeWebsocket() {
		return fMaxAgeWebsocket;
	}

	/**
	 * Gets the interval of statistics-dumps.
	 * @return duration of interval
	 */
	public TemporalAmount getStatisticsInterval() {
		return fStatisticsInterval;
	}
	
	/**
	 * Gets the idle-timeout of a websocket-session.
	 * @return timeout
	 */
	public TemporalAmount getWebSocketIdleTimeout() {
		return fWebSocketIdleTimeout;
	}

	/**
	 * Gets the locale of the server.
	 * @return locale
	 */
	public Locale getLocale() {
		return fLocale;
	}
	
	/**
	 * Gets the time-zone of the server.
	 * @return zone
	 */
	public ZoneId getTimeZone() {
		return fTimeZone;
	}

	/**
	 * Gets the configuration of a duration.
	 * @param key property-name
	 * @param defaultDuration default-value
	 * @return duration
	 */
	private static TemporalAmount getDuration(final String key, final Duration defaultDuration) {
		final TemporalAmount temporalAmount;
		final String sDuration = System.getProperty(key);
		if (sDuration != null) {
			temporalAmount = Duration.parse(sDuration);
		}
		else {
			temporalAmount = defaultDuration;
		}
		return temporalAmount;
	}
	
	/**
	 * Gets the configuration of a locale.
	 * @param key property-name
	 * @param defaultValue default-value
	 * @return locale
	 */
	private static Locale getLocale(final String key, final Locale defaultValue) {
		final Locale locale;
		final String sLocale = System.getProperty(key);
		if (sLocale != null) {
			locale = new Locale(sLocale);
		}
		else {
			locale = defaultValue;
		}
		return locale;
	}

	/**
	 * Gets the configuration of a string-value.
	 * @param key property-name
	 * @param defaultValue default-value
	 * @return string-value
	 */
	private static String getString(final String key, final String defaultValue) {
		final String propValue = System.getProperty(key);
		final String value = (propValue != null) ? propValue : defaultValue;
		return value;
	}
}
