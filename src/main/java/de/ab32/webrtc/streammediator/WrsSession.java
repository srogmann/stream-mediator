package de.ab32.webrtc.streammediator;

import java.time.Instant;

/**
 * Start-time and WRS-session-Id.
 */
public class WrsSession {

	/** start-time of the session */
	private final Instant fTsStart;

	/** session-id */
	private final String fSessionId;

	/**
	 * Constructor
	 * @param sessionId sesion-id
	 */
	public WrsSession(final String sessionId) {
		fTsStart = Instant.now();
		fSessionId = sessionId;
	}

	/**
	 * Gets the start-time.
	 * @return start-time
	 */
	public Instant getTsStart() {
		return fTsStart;
	}
	
	/**
	 * Gets the session-Id.
	 * @return session-Id
	 */
	public String getSessionId() {
		return fSessionId;
	}
}
