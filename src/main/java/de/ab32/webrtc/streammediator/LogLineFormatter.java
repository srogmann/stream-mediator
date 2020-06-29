package de.ab32.webrtc.streammediator;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.logging.Formatter;
import java.util.logging.LogRecord;

/**
 * Logging formatter which logs level, package-shortened class and message only.
 */
public class LogLineFormatter extends Formatter {
	
	/** package-name */
	private static final String PREFIX_PACKAGE = LogLineFormatter.class.getName().replaceFirst("[.][^.]*$", "");

	/** short package-name */
	private static final String PREFIX_PACKAGE_SHORT = PREFIX_PACKAGE.replaceAll("([A-Za-z])[^.]*[.]?", "$1");
	
	/** {@inheritDoc} */
	@Override
	public String format(final LogRecord record) {
		final StringBuilder sb = new StringBuilder(100);
		sb.append(record.getLevel());
		sb.append(' ');
		final String loggerName = record.getLoggerName();
		if (loggerName.startsWith(PREFIX_PACKAGE)) {
			sb.append(PREFIX_PACKAGE_SHORT).append(loggerName, PREFIX_PACKAGE.length(), loggerName.length());
		}
		else {
			sb.append(loggerName);
		}
		sb.append(':');
		sb.append(' ');
		sb.append(record.getMessage()).append(System.lineSeparator());
		
		final Throwable t = record.getThrown();
		if (t != null) {
			final StringWriter sw = new StringWriter(100);
			t.printStackTrace(new PrintWriter(sw));
			sb.append(sw);
		}

		return sb.toString();
	}

}
