package de.ab32.webrtc.streammediator.lang;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Map.Entry;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.logging.Level;
import java.util.logging.Logger;

import javax.json.Json;
import javax.json.JsonException;
import javax.json.JsonObject;
import javax.json.JsonReader;
import javax.json.JsonString;
import javax.json.JsonValue;

/**
 * Language and dictionary.
 */
public class WrsLanguage {
	/** default-language is "en" */
	private static final String LANG_DEFAULT = "en";

	/** Logger */
	private static final Logger LOGGER = Logger.getLogger(WrsLanguage.class.getName());
	
	/** Map from language tag to dictionary */
	private static final ConcurrentMap<String, WrsLanguage> MAP = new ConcurrentHashMap<>();

	/** language tag */
	private final String fLang;
	
	/** dictionary in JSON-format */
	private final String fJsonDictionary;
	
	/** Map from key to translation */
	private final Map<String, String> fDictionary;
	
	/**
	 * Constructor
	 * @param lang language tag
	 * @param jsonDictionary Dictionary in JSON-format
	 * @throws JsonException in case of a JSON-error
	 */
	public WrsLanguage(final String lang, final String jsonDictionary) throws JsonException {
		fLang = lang;
		fJsonDictionary = jsonDictionary;
		final Map<String, String> dictionary = parseDictionary(jsonDictionary);
		fDictionary = dictionary;
	}

	/**
	 * Parses the dictionary-map.
	 * @param jsonDictionary JSON-map
	 * @return map
	 * @throws JsonException in case of a JSON-error
	 */
	static Map<String, String> parseDictionary(String jsonDictionary) throws JsonException {
		final JsonObject json;
		try (final JsonReader reader = Json.createReader(new StringReader(jsonDictionary))) {
			json = reader.readObject();
		}
		final Map<String, String> map = new HashMap<String, String>(json.size());
		for (Entry<String, JsonValue> entry : json.entrySet()) {
			final String key = entry.getKey();
			final JsonValue value = entry.getValue();
			final String text;
			if (value instanceof JsonString) {
				final JsonString jText = (JsonString) value;
				text = jText.getString();
			}
			else {
				text = value.toString();
			}
			map.put(key, text);
		}
		return map;
	}

	/**
	 * Reads a dictionary.
	 * @param lang language-tag
	 * @param useFallback <code>true</code> if fallback may be used
	 * @return language and dictionary or <code>null</code>
	 */
	public static WrsLanguage readDictionary(final String lang, final boolean useFallback) {
		WrsLanguage wrsLanguage = MAP.get(lang);
		if (wrsLanguage == null) {
			// There isn't a language-entry in the map yet.
			final String ressourceName = lang + ".json";
			LOGGER.info(String.format("Read dictionary-ressource %s of language %s", ressourceName, lang));
			final InputStream is = WrsLanguage.class.getResourceAsStream(ressourceName);
			if (is == null && useFallback) {
				return readDictionary(LANG_DEFAULT, false);
			}
			if (is == null) {
				return null;
			}
			final StringBuilder sb = new StringBuilder(1000);
			final char[] buf = new char[1000];
			try (InputStreamReader isr = new InputStreamReader(is, StandardCharsets.UTF_8)) {
				while (true) {
					final int len = isr.read(buf);
					if (len <= 0) {
						break;
					}
					sb.append(buf, 0, len);
				}
			}
			catch (IOException e) {
				LOGGER.log(Level.SEVERE, String.format("readDictionary: IOException while reading ressource (%s)", ressourceName), e);
				return null;
			}
			
			try {
				wrsLanguage = new WrsLanguage(lang, sb.toString());
			} catch (JsonException e) {
				LOGGER.log(Level.SEVERE, String.format("readDictionary: JsonException while parsing ressource (%s)", ressourceName), e);
				return null;
			}
			MAP.put(lang, wrsLanguage);
		}
		return wrsLanguage;
	}
	
	/**
	 * Gets the language tag (e.g. "de", "en" or "zh-Hans").
	 * @return language tag
	 */
	public String getLang() {
		return fLang;
	}

	/**
	 * Gets the dictionary.
	 * @return map from key to translation
	 */
	public Map<String, String> getDictionary() {
		return fDictionary;
	}

	/**
	 * Gets the dictionary in JSON-format.
	 * @return dictionary
	 */
	public String getJsonDictionary() {
		return fJsonDictionary;
	}
}
