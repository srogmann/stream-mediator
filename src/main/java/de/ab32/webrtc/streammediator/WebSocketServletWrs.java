package de.ab32.webrtc.streammediator;

import java.util.logging.Handler;
import java.util.logging.Logger;

import org.eclipse.jetty.websocket.servlet.WebSocketServlet;
import org.eclipse.jetty.websocket.servlet.WebSocketServletFactory;

/**
 * Servlet to serve WebRTC-WebSocket.
 */
public class WebSocketServletWrs extends WebSocketServlet {

	/** Serialization-Id */
	private static final long serialVersionUID = 20200418L;
	
	/** {@inheritDoc} */
	@Override
	public void configure(WebSocketServletFactory factory) {
		// Configure logging. We use just the simple java.util.logging-API.
		final Logger rootLogger = Logger.getLogger("");
		final Handler[] handlers = rootLogger.getHandlers();
		if (handlers.length > 0) {
			final LogLineFormatter formatter = new LogLineFormatter();
			handlers[0].setFormatter(formatter);
		}
		
		// Register web-socket.
		factory.register(WebSocketWrs.class);
	}

}
