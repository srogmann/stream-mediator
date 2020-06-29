/** controller.js --- Multi-stream WebRTC-application
 * 
 * 2020-06-22, Version 0.2.19, Sascha Rogmann
 * 
 * License: GPLv2 (http://www.gnu.org/licenses/old-licenses/gpl-2.0.html)
 */
// There are a lot of sources:
// # https://blog.mozilla.org/webrtc/perfect-negotiation-in-webrtc/
// # https://davekilian.com/webrtc-the-hard-way.html
// # https://developer.mozilla.org/en-US/docs/Web/Guide/Audio_and_video_delivery/Video_player_styling_basics
// # https://github.com/webrtc/samples/blob/bdd6a6ee0e49f5ef9c8358f91f78e47b389f77aa/src/content/capture/canvas-pc/js/main.js#L25-L40
// # https://webrtc.org/getting-started/peer-connections
// # https://blog.mozilla.org/webrtc/ice-disconnected-not/
// # http://www.inkscape.org/
// # https://github.com/wikimedia/jquery.i18n
// # ...
'use strict';

/** websocket-URL, e.g. wss://www.ab32.de/wrs/WebSocketServlet/ (page-URL https://www.ab32.de/wrs/) */
const WEB_SOCKET_URL = document.URL.replace(/http(.*)\/[^\/]*$/, 'ws$1/WebSocketServlet');
/** manager of websocket-connection */
var wsManager = new WebSocketSessionManager(WEB_SOCKET_URL, handleMessage);

/** localization */
var i18n = new SimpleI18N();

/** messages */
var messages = new Messages();

/** current RT-Connections: map from peerKey (peerName.peerNr) to VideoBoxRTCPeerConnection */
var rtcConnections = {};
/** current RT-Channels: map from peerKey (peerName.peerNr) to DataChannel */
var rtcChannels = {};

/** map from peerName to VideoBox */
var mapPeerNameVideoBox = {};
/** map from boxNr to VideoBox */
var mapNrVideoBox = {};

// The different type of boxes are called video-boxes.

/** global counter of video-boxes on our page */
var lastBlockNr = 0;

/** layout-controller */
var layout = new LayoutVideoBoxes();

/** constant VideoBox isLocalStream = true */
const BOX_LOCAL = true;
/** constant VideoBox isLocalStream = false */
const BOX_REMOTE = false;
/** Boxtyp "Anfragefenster" */
const BOX_TYPE_REQUEST = 0;
/** Boxtyp "Video" */
const BOX_TYPE_VIDEO = 1;
/** Boxtyp "Screen" */
const BOX_TYPE_SCREEN = 2;
/** Boxtyp "Chat" */
const BOX_TYPE_CHAT = 3;

/** Schlüssel zur Anzeige des Typs einer VideoBox */
const MSG_KEY_BOX_TYPE = 'keyBoxType';

/** number of video-ox of local user */
const NR_LOCAL_USER = 0;

/**
 * Returns an element by selector.
 * 
 * @param selector
 *            selector
 * @returns HTML-element
 */
function $(selector) {
	if (selector) {
		let el = document.querySelector(selector);
		if (!el) {
			throw `No elements matching selector (${selector}).`;
		}
		return el;
	}
}
// Register the translate function.
$.i18n = function(template, ...args) {
	return i18n.translate(template, args);
}

/**
 * Return all elements by selector.
 * 
 * @param selector
 *            selector
 * @returns HTML-elements
 */
function $$(selector) {
	let el = document.querySelectorAll(selector);
	if (!el) {
		throw `No elements matching selector (${selector}).`;
	}
	return el;
}

/**
 * Simple localization.
 * Each element to be localized gets an attribute "data-i18n".
 * Example: <p data-i18n="msg;[title]msgTitle" title="Tooltip Beispiel">Beispiel</p>
 * The keys are "msg" of the element-text and "msgTitle" of the tooltip.
 */
function SimpleI18N() {
	this.lang = navigator.language || navigator.userLanguage;
	this.dictionary = {};
	
	this.request = function(lang) {
		console.log('SimpleI18N: request lang %s', lang);
		wsManager.send({ 
			type: "dictionary",
			session: $('#sessionId').value, 
			lang: lang
		});
	}
	
	this.load = function(lang, dictionary) {
		this.lang = lang;
		this.dictionary = dictionary;
		
		const regexpAttrKey = /(?:\[(.*)\])?(.*)/;
		var numElements = 0;
		var numAttrs = 0;
		var numUnknownKeys = 0;
		$$('*[data-i18n]').forEach((el) => {
			let attrKeys = el.getAttribute('data-i18n');
			var attrArg1 = el.getAttribute('data-i18n-arg1');
			var attrArg2 = el.getAttribute('data-i18n-arg2');
			attrKeys.split(';').forEach((attrKey) => {
				let match = attrKey.match(regexpAttrKey);
				let attrName = match[1];
				let key = match[2];
				let html = this.translate(key, attrArg1, attrArg2);
				if (!html) {
					if (numUnknownKeys < 10) {
						console.log('unknown data-i18n-key: %s', key);
					}
					numUnknownKeys++;
				}
				else if (attrName) {
					el.setAttribute(attrName, html);
					numAttrs++;
				}
				else {
					el.innerHTML = html;
					numElements++;
				}
			});
		});
		console.log('SimpleI18N: numElements=%d, numAttrs=%d, numUnknownKeys=%s', numElements, numAttrs, numUnknownKeys);

		// Refresh the status-messages of all video-boxes.
		for (let nr in mapNrVideoBox) {
			let videoBox = mapNrVideoBox[nr];
			videoBox.showVideoBoxMessages(false);
		}
	}
	
	/**
	 * Translates a template and fills arguments.
	 * A $n in the dictionary value represents the n-th argument. 
	 * @param key key in dictionary
	 * @param aArgs array of optional arguments referenced by "$n" in the dictionary value
	 * @return translated text
	 */
	this.translate = function(key, aArgs) {
		let dictValue = this.dictionary[key]; 
		let template = dictValue ? dictValue : key;
		let result = template.replace(/[$]([0-9]+)/g, function(match, token) {
			let arg = aArgs[token - 1];
			if (!arg) {
				console.error(`Unknown argument (${match}) of (${args}) in "${template}"`);
			}
			return arg;
		});
		return result;
	}
}

/**
 * Class to be used for displaying and collecting of messages.
 */
function Messages() {
	this.listMessages = [];

	/**
	 * Display a messages.
	 * @param msg untranslated message
	 */
	this.showMessage = function(msg, ...args) {
		let msgEntry = {
			ts: new Date(),
			text: msg,
			args: args
		};
		this.listMessages.push(msgEntry);
		
		var elMessage = $('#message');
		elMessage.setAttribute('data-i18n', msg);
		if (i18n.dictionary.size > 0) {
			elMessage.textContent = $.i18n(msg);
		}
		else {
			elMessage.textContent = msg;
		}
		let heightHeader = $('#header').offsetHeight;
		$('#content').style.marginTop = heightHeader + 'px';
	}
	
	this.showMessages = function() {
		var elDiv = $('#messages');
		elDiv.innerHTML = "<h2 data-i18n=\"h2.messages\">" + $.i18n("h2.messages") + "</h2>";
		var messagesOutput = "";
		messagesOutput += "<ul>";
		for (let msgEntry of this.listMessages) {
			let ts = msgEntry.ts;
			let h = ts.getHours();
			let m = ts.getMinutes();
			let s = ts.getSeconds();
			let hhmmss = ((h < 10) ? '0' : '') + h
				+ ':' + ((m < 10) ? '0' : '') + m
				+ ':' + ((s < 10) ? '0' : '') + s;
			let text = msgEntry.text;
			messagesOutput += `<li>${hhmmss}: ${text}</li>\r\n`;
		}
		messagesOutput += "</ul>";
		elDiv.innerHTML += messagesOutput;
	}
}

/**
 * Initialization after initial DOM-build.
 */
function initPage() {
	var elMessage = $('#message');
	var elMenu = $('#menu');
	if (!elMessage || !elMenu) {
		alert($.i18n("Error in the page's HTML-code: #message or #menu is missing."));
		return;
	}

	elMenu.addEventListener("click", function(event) {
		var elMenuContent = $('#menuContent');
		var elOuterRim = $$('div.outerRim');
		if (elMenuContent.style.width == "0px") {
			elMenuContent.style.width = "15em";
			elOuterRim.forEach((el) => el.style.opacity = 0.0);
		}
		else {
			elMenuContent.style.width = "0px";
			elOuterRim.forEach((el) => el.style.opacity = 1.0);
		}
	});

	$('#newPeerBtn').addEventListener("click", function(event) {
		addNewPeer();
	});
	
	$('#stopVideoBtn').addEventListener("click", function(event) {
		stopAllStreams();
	});

	$('#btnStyle1').addEventListener("click", function(event) {
		layout.resizeVideoBoxes(0.22);
	});
	$('#btnStyle2').addEventListener("click", function(event) {
		layout.resizeVideoBoxes(0.4);
	});
	$('#btnStyle3').addEventListener("click", function(event) {
		layout.resizeVideoBoxes(0.9);
	});
	
	new VideoBox(BOX_TYPE_VIDEO, BOX_LOCAL, null, null, null);
	layout.resizeVideoBoxes(0.4);
	$$('.controls button').forEach((el) => el.style.display = "none");
	mapNrVideoBox[NR_LOCAL_USER].elConnectBtn.style.display = "block";
	mapNrVideoBox[NR_LOCAL_USER].elExitBtn.style.display = "block";
}

function addNewPeer() {
	let videoBoxLocal = searchVideoBoxLocal();
	if (videoBoxLocal == null) {
		messages.showMessage($.i18n("Öffne zunächst ein eigenes Fenster (Videofenster, Fenster teilen oder eine reine Anfragebox)"));
	}
	else if (videoBoxLocal.elUser.value.trim() == "") {
		messages.showMessage($.i18n("Gib zunächst Deinen eigenen Namen bzw. Dein eigenes Kürzel oder Pseudonym an."));
	}
	else {
		new VideoBox(BOX_TYPE_REQUEST, BOX_REMOTE, null, null, null);
	}
}

/** Function for creating a new videobox via javascript-link */
function createVideoBox(boxType, isLocalStream, localName, peerName, peerNr) {
	new VideoBox(boxType, isLocalStream, localName, peerName, peerNr);
}

/**
 * Creates a figure-element containing a video-element and controls. If a peer
 * name is given a WebRTC-connection will be initialized.
 * 
 * @param boxType Typ der Videobox (BOX_TYPE_VIDEO, BOX_TYPE_SCREEN, BOX_TYPE_CHAT oder BOX_TYPE_REQUEST)
 * @param isLocalStream
 *            true if the stream is local, false if the stream is remote
 * @param localName optional name of local video-box
 * @param peerName
 *            optional name of peer
 * @param peerNr optional number of peer's video-box
 */
function VideoBox(boxType, isLocalStream, localName, peerName, peerNr) {
	var nr = lastBlockNr++;
	if (isLocalStream) {
		console.log("createVideoBox: local %s", boxType);
	}
	else {
		if (peerName) {
			console.log("createVideoBox: remote, boxType=%s, nr=%s, peerName=%s, peerKey=%s",
					boxType, nr, peerName, peerNr);
		}
		else {
			console.log("createVideoBox: remote, boxType=%s, nr=%s", boxType, nr);
		}
	}
	this.elFigure = document.createElement("figure");
	this.elFigure.setAttribute('id', `figure${nr}`);
	this.elFigure.setAttribute('class', 'video');
	this.elFigure.setAttribute('data-boxType', boxType);
	$('#videoBoxes').appendChild(this.elFigure);
	let labelNameI18n = (isLocalStream) ? "Dein Name:" : "Teilnehmer $1:";
	let labelName = $.i18n(labelNameI18n, nr);
	let tooltipNameI18n = (isLocalStream) ? "Im Feld &bdquo;Dein Name&ldquo; wird der eigene Name, das eigene Kürzel oder auch das eigene Pseudonym eingetragen."
			: "Im Feld &bdquo;Teilnehmer&ldquo; wird der Name der Gegenseite bzw. ihr Kürzel oder Pseudonym eingetragen.";
	let tooltipName = $.i18n(tooltipNameI18n);
	let muted = isLocalStream ? "muted" : "";
	let tooltipConnectI18n;
	let videoBoxContent;
	if (boxType == BOX_TYPE_SCREEN) {
		tooltipConnectI18n = (isLocalStream) ? "Anmeldung am Server und Wahl eines eigenen Fensters"
				: "Gegenseite zwecks Fenster-Teilen anrufen";
		videoBoxContent = `  <video id="video${nr}" autoplay controls width="320" height="240"></video>`;
	}
	else if (boxType == BOX_TYPE_CHAT) {
		tooltipConnectI18n = (isLocalStream) ? "Anmeldung am Server mit Textchat"
				: "Gegenseite zwecks Textchat-Teilen anrufen";
		videoBoxContent = `  <textarea id="video${nr}" name="Chatfenster" cols="80" rows="10" readonly></textarea>
			<textarea id="video${nr}input" name="Chatfenstereingabe" cols="80" rows="2"></textarea>`;
	}
	else if (boxType == BOX_TYPE_REQUEST) {
		tooltipConnectI18n = (isLocalStream) ? "Anmeldung am Server ohne (weitere) eigene Bereitstellung"
				: "Gegenseite zwecks Video- oder Fenster-Teilen anrufen";
		videoBoxContent = `  <video id="video${nr}" autoplay controls ${muted} width="320" height="240"></video>`;
	}
	else {
		tooltipConnectI18n = (isLocalStream) ? "Anmeldung am Server und Aktivieren der eigenen Kamera"
				: "Gegenseite zwecks gemeinsamer Videoverbindung anrufen";
		videoBoxContent = `  <video id="video${nr}" autoplay controls ${muted} width="320" height="240"></video>`;
	}
	let tooltipConnect = $.i18n(tooltipConnectI18n);
	let tooltipHangupI18n = "Dieses Videofenster beenden";
	let tooltipHangup = $.i18n(tooltipHangupI18n);
	let tooltipMuteVideoI18n = "Das eigene Videobild ausschalten.";
	let tooltipMuteAudioI18n = "Den eigenen Ton ausschalten.";
	let tooltipMuteVideo = $.i18n(tooltipMuteVideoI18n);
	let tooltipMuteAudio = $.i18n(tooltipMuteAudioI18n);
	let muteButtonVideo = (isLocalStream && boxType != BOX_TYPE_CHAT && boxType != BOX_TYPE_REQUEST) ? `<button id="muteVideoBtn${nr}"  class="svg" data-state="muteVideo" draggable="true" title="${tooltipMuteVideo}" data-i18n="[title]${tooltipMuteVideoI18n}">Mute Video</button>` : "";
	let muteButtonAudio = (isLocalStream && boxType == BOX_TYPE_VIDEO) ? `<button id="muteAudioBtn${nr}"  class="svg" data-state="muteAudio" draggable="true" title="${tooltipMuteAudio}" data-i18n="[title]${tooltipMuteAudioI18n}">Mute Audio</button>` : "";
	let tooltipMoveI18n = "Dieses Videofenster an eine andere Stelle schieben.";
	let tooltipLayerUpI18n = "Dieses Videofenster eine Ebene hoch schieben.";
	let tooltipLayerDownI18n = "Dieses Videofenster eine Ebene runter schieben.";
	let tooltipZoomInI18n = "Dieses Videofenster vergrößern.";
	let tooltipZoomOutI18n = "Dieses Videofenster verkleinern.";
	let tooltipMove = $.i18n(tooltipMoveI18n);
	let tooltipLayerUp = $.i18n(tooltipLayerUpI18n);
	let tooltipLayerDown = $.i18n(tooltipLayerDownI18n);
	let tooltipZoomIn = $.i18n(tooltipZoomInI18n);
	let tooltipZoomOut = $.i18n(tooltipZoomOutI18n);
	let htmlBox = `${videoBoxContent}
	  <div class="controls videoBoxName">
		<label for="user${nr}" data-i18n="${labelNameI18n}" data-i18n-arg1="${nr}">${labelName}</label>
		<input type="text" id="user${nr}" size="10" title="${tooltipName}" maxlength="40" data-i18n="[title]${tooltipNameI18n}"/>
	  </div>
	  <div class="controls videoBoxButtons">
		<button id="connectBtn${nr}" class="svg" data-state="connect" title="${tooltipConnect}" data-i18n="[title]${tooltipConnectI18n}">Verbindungsaufbau</button> 
		<button id="hangupBtn${nr}"  class="svg" data-state="hangup" title="${tooltipHangup}" data-i18n="[title]${tooltipHangupI18n}">Auflegen</button>
		${muteButtonVideo}
		${muteButtonAudio}
		<button id="moveBtn${nr}"    class="svg" data-state="move" draggable="true" title="${tooltipMove}" data-i18n="[title]${tooltipMoveI18n}">Bewegen</button>
		<button id="layerUpBtn${nr}"  class="svg" data-state="layerUp" title="${tooltipLayerUp}" data-i18n="[title]${tooltipLayerUpI18n}">Hoch</button>
		<button id="layerDownBtn${nr}"  class="svg" data-state="layerDown" title="${tooltipLayerDown}" data-i18n="[title]${tooltipLayerDownI18n}">Runter</button>
		<button id="zoomInBtn${nr}"  class="svg" data-state="zoomIn" title="${tooltipZoomIn}" data-i18n="[title]${tooltipZoomInI18n}">Vergrößern</button>
		<button id="zoomOutBtn${nr}" class="svg" data-state="zoomOut" title="${tooltipZoomOut}" data-i18n="[title]${tooltipZoomOutI18n}">Verkleinern</button>
		<button id="exitBtn${nr}" class="svg" data-state="exit">Videobox schließen</button>
	  </div>
	  <div class="videoMessage"><div id="videoMessages${nr}"></div></div>`;
	this.elFigure.innerHTML = htmlBox;
	this.elUser = $(`#user${nr}`);
	this.elConnectBtn = $(`#connectBtn${nr}`); 
	this.elHangupBtn = $(`#hangupBtn${nr}`);
	this.elMoveBtn = $(`#moveBtn${nr}`);
	this.elLayerUpBtn = $(`#layerUpBtn${nr}`);
	this.elLayerDownBtn = $(`#layerDownBtn${nr}`);
	this.elZoomInBtn = $(`#zoomInBtn${nr}`);
	this.elZoomOutBtn = $(`#zoomOutBtn${nr}`);
	this.elExitBtn = $(`#exitBtn${nr}`);
	this.elVideo = $(`#video${nr}`);
	this.elDivMessages = $(`#videoMessages${nr}`);
	
	this.nr = nr;
	this.localName = localName;
	this.isLocalStream = isLocalStream;
	this.boxType = boxType;
	this.isActive = false;
	this.peerName = peerName;
	this.peerNr = peerNr;
	this.messages = {};
	mapNrVideoBox[nr] = this;
	
	this.getBoundingClientRect = function() {
		let el;
		if (boxType == BOX_TYPE_CHAT) {
			el = $(`#video${nr}input`);
		}
		else if (this.elVideo) {
			el = this.elVideo;
		}
		else {
			el = this.elFigure;
		}
		return el.getBoundingClientRect();
	}
	
	this.resize = function(newX, newY, newWidth, newHeight) {
		this.elFigure.style.position = "absolute";
		this.elFigure.style.left = (newX + "px");
		this.elFigure.style.top = (newY + "px");
		let el;
		if (boxType == BOX_TYPE_CHAT) {
			el = $(`#video${nr}input`);
		}
		else if (this.elVideo) {
			el = this.elVideo;
		}
		else {
			el = this.elFigure;
		}
		el.style.width = (newWidth + "px");
		if (boxType != BOX_TYPE_VIDEO && boxType != BOX_TYPE_SCREEN) {
			el.style.height = (newHeight + "px");
		}
	}

	this.showVideoBoxMessages = function(sendBroadcast) {
		// Identify the values of the map-entries.
		let aMessages = [];
		// mapMsgs: map from type to message (the message is to be translated).
		let mapMsgs = this.messages;
		for (let type in mapMsgs) {
			let msgValue = mapMsgs[type];
			if (Array.isArray(msgValue)) {
				// This entry is an array of values.
				for (let msg of msgValue) {
					aMessages.push(msg);
				}
			}
			else {
				aMessages.push(msgValue);
			}
		}

		// Build the strings of messages to be displayed.
		let msgDisplay = "";
		for (let msg of aMessages) {
			if (msgDisplay.length > 0) {
				msgDisplay += ", ";
			}
			msgDisplay += $.i18n(msg);
		}
		console.log("showVideoBoxMessages: mapMsgs=%s, msg=%s", JSON.stringify(mapMsgs), msgDisplay);

		var elDiv = this.elDivMessages;
		elDiv.textContent = msgDisplay;
		if (msgDisplay.length == 0) {
			elDiv.style.display = "none";
		}
		else {
			elDiv.style.display = "inline";
		}

		let localName = cleanName(this.elUser.value);
		if (sendBroadcast && this.isLocalStream) {
			sendDataBroadcast(localName, {type: 'videoBoxStatus', status: aMessages});
		}
	}

	/**
	 * Refresh the messages-map of a video-box.
	 * @param videoBox video-box
	 * @param flag boolean-flag
	 * @param mapKey key in messages-map of the video-box
	 * @param mapDisplayValue text to be displayed if flag is true
	 */
	this.refreshVideoBoxBoolean = function(flag, mapKey, mapDisplayValue) {
		let mapMsgs = this.messages;
		if (flag) {
			mapMsgs[mapKey] = mapDisplayValue;
		}
		else {
			delete mapMsgs[mapKey];
		}
		this.showVideoBoxMessages(true);
	}

	this.watchVideoElement = function(elVideo) {
		var id = elVideo.id;
		elVideo.addEventListener('loadedmetadata', function() {
			console.log("loadedmetadata: id=%s, w=%s, h=%s",
					id, this.videoWidth, this.videoHeight);
			let aspectRatio = this.videoWidth * 1.0 / this.videoHeight;
			elVideo.setAttribute("data-aspect", aspectRatio);
			let elFigure = elVideo.parentElement;
		});
	}

	this.addChatMessage = function(data, peerName) {
		let tsNow = new Date();
		let h = tsNow.getHours();
		let m = tsNow.getMinutes();
		let s = tsNow.getSeconds();
		let hhmmss = ((h < 10) ? '0' : '') + h
			+ ':' + ((m < 10) ? '0' : '') + m
			+ ':' + ((s < 10) ? '0' : '') + s; 
		let elTextarea = this.elVideo;
		let prefix = data.isGenerated ? '#' : '$';
		elTextarea.value += `${hhmmss} ${peerName}${prefix} ${data.msg}\r\n`;
		elTextarea.scrollTop = elTextarea.scrollHeight;
		if (this.messages[MSG_KEY_BOX_TYPE]) {
			delete this.messages[MSG_KEY_BOX_TYPE];
			this.showVideoBoxMessages(false);
		}
	}

	if (boxType != BOX_TYPE_CHAT) {
		this.watchVideoElement(this.elVideo);
	}

	layout.checkVideoBoxLayout(this);

	// vx, vy, x1, y1: positions of video-box and mouse, set in touchStart.
	var vx = 0;
	var vy = 0;
	var x1 = 0;
	var y1 = 0;

	let boxTypeAnzeige = null;
	if (isLocalStream) {
		if (boxType == BOX_TYPE_VIDEO) {
			boxTypeAnzeige = "Teile eigene Kamera";
		}
		else if (boxType == BOX_TYPE_SCREEN) {
			boxTypeAnzeige = "Teile eigenen Fenster-Stream";
		}
		else if (boxType == BOX_TYPE_CHAT) {
			boxTypeAnzeige = "Gemeinsames Chat-Fenster";
		}
		else if (boxType == BOX_TYPE_REQUEST) {
			// Es wird nichts bereitgestellt.
			boxTypeAnzeige = "Anmeldung ohne eigenen Inhalt";
		}
		else {
			boxTypeAnzeige = "?";
			console.error("Unknown boxType %s", boxType);
		}
	}
	else {
		boxTypeAnzeige = "Teilnehmer anrufen";
	}
	if (boxType == BOX_TYPE_CHAT) {
		var elInput = $(`#video${nr}input`);
		elInput.addEventListener("keypress", ev => this.onInputKeyPress());
		this.onInputKeyPress = function () {
			let key = window.event.keyCode;
			let text = elInput.value;
			if (key == 13 && text.trim() != '') {
				let videoBoxLocal = searchVideoBoxLocal();
				if (videoBoxLocal && videoBoxLocal.localName) {
					let localName = videoBoxLocal.localName;
					let dataChat = {type: 'chat', localName: localName, msg: text, isGenerated: false};
					sendDataBroadcast(localName, dataChat);
					this.addChatMessage(dataChat, localName);
					elInput.value = '';
					return false;
				}
				else {
					messages.showMessage($.i18n("Zum Senden einer Nachricht per Chatbox muss zunächst eine Verbindung zu anderen hergestellt werden, beispielsweise per Video-Chat, Fenster teilen oder Requext-Box."));
				}
			}
			return true;
		}
	}
	
	this.messages[MSG_KEY_BOX_TYPE] = boxTypeAnzeige;
	this.showVideoBoxMessages(false);

	if (peerName && peerNr) {
		initVideoBoxConnectionZuPeer(localName, nr, peerName, peerNr);
	}
	else {
		this.elUser.focus();
		if (boxType != BOX_TYPE_CHAT) {
			this.elConnectBtn.style.display = "block";
		}
	}

	this.elConnectBtn.addEventListener("click", ev => this.connectBtnClicked());
	this.connectBtnClicked = function () {
		if (isLocalStream) {
			handleLogin(boxType, this.elUser.value, nr);
		}
		else {
			var curPeerName = cleanName(this.elUser.value);
			if (curPeerName != this.elUser.value) {
				this.elUser.value = curPeerName;
			}
			let videoBoxLocal = searchVideoBoxLocal();
			if (!videoBoxLocal) {
				messages.showMessage($.i18n("Ein eigenes Fenster (Videofenster, Fenster teilen oder eine reine Anfragebox) fehlt."));
			}
			else if (curPeerName.length > 0) {
				this.elUser.readOnly = true;
				mapPeerNameVideoBox[curPeerName] = mapNrVideoBox[nr];
				wsManager.send({ 
					type: "requestCall",
					name: cleanName(videoBoxLocal.elUser.value),
					boxType: boxType,
					localNr: nr,
					peer: curPeerName,
					session: $('#sessionId').value
				});
			}
			else {
				messages.showMessage($.i18n("Der Name $1 wird für den Verbindungsaufbau benötigt.", nr));
				this.elUser.readOnly = false;
				this.elUser.focus();
			}
		}
	}

	this.elHangupBtn.addEventListener("click", ev => this.hangupBtnClicked());
	this.hangupBtnClicked = function() {
		console.log("elHangupBtn: nr=%s, isLocalStream=%s", nr, isLocalStream);
		if (isLocalStream) {
			this.refreshVideoBoxBoolean(true, 'hangup', "Aufgelegt");
			stopVideoLocal(this);
			handleLogout(this);
		}
		else {
			let peerName = this.elUser.value;
			stopVideoRemote(peerName);
		}
	}

	if (isLocalStream && boxType != BOX_TYPE_REQUEST && boxType != BOX_TYPE_CHAT) {
		var elMuteVideoBtn = $(`#muteVideoBtn${this.nr}`);
		elMuteVideoBtn.addEventListener("click", ev => this.muteVideoBtnClicked());
		this.muteVideoBtnClicked = function() {
			let wasMuted = (this.elVideo.getAttribute('data-video-muted') == "true");
			console.log("elMuteVideoBtn: wasMuted=%s", wasMuted);
			let stream = this.elVideo.srcObject;
			if (stream) {
				let videoTracks = stream.getVideoTracks();
				if (videoTracks.length > 0) {
					let isMuted = !wasMuted;
					videoTracks[0].enabled = !isMuted;
					this.elVideo.setAttribute('data-video-muted', isMuted);
					elMuteVideoBtn.style.opacity = (isMuted) ? "0.3" : "1.0";
					
					this.refreshVideoBoxBoolean(isMuted, 'video-muted', "Video muted");
				}
			}
			else {
				console.log('elMuteVideoBtn: stream not yet available.');
			}
		}
	}		
	if (isLocalStream && boxType == BOX_TYPE_VIDEO) {
		var elMuteAudioBtn = $(`#muteAudioBtn${nr}`);
		elMuteAudioBtn.addEventListener("click", ev => this.muteAudioBtnClicked());
		this.muteAudioBtnClicked = function() {
			let wasMuted = (this.elVideo.getAttribute('data-audio-muted') == "true");
			console.log("elMuteAudioBtn: wasMuted=%s", wasMuted);
			let stream = this.elVideo.srcObject;
			if (stream) {
				let audioTracks = stream.getAudioTracks();
				if (audioTracks.length > 0) {
					let isMuted = !wasMuted;
					audioTracks[0].enabled = !isMuted;
					this.elVideo.setAttribute('data-audio-muted', isMuted);
					elMuteAudioBtn.style.opacity = (isMuted) ? "0.3" : "1.0";
					
					this.refreshVideoBoxBoolean(isMuted, 'audio-muted', "Audio muted");
				}
			}
			else {
				console.log('elMuteAudioBtn: stream not available');
			}
		}
	}

	this.elMoveBtn.addEventListener('mousedown', ev => this.moveBtnOnMouseDown(ev));
	this.moveBtnOnMouseDown = function(event) {
		layout.switchToAbsoluteLayout();
		var viewportWidth = window.innerWidth;
		var rectVideo = this.elVideo.getBoundingClientRect();
		vx = rectVideo.x + window.scrollX;
		vy = rectVideo.y + window.scrollY;
		var x1 = event.clientX;
		var y1 = event.clientY;
		var currentElFigure = this.elFigure;
		console.log("DragStart: (%s, %s) - (%s, %s)", vx, vy,
				x1, y1);
		document.onmouseup = function(event) {
			document.onmouseup = null;
			document.onmousemove = null;
			var x2 = event.clientX;
			var y2 = event.clientY;
			console.log("DragEnde: (%s, %s) - (%s, %s)", rectVideo.x, rectVideo.y,
					x2, y2);
		};
		document.onmousemove = function(event) {
			var x2 = event.clientX;
			var y2 = event.clientY;
			currentElFigure.style.position = "absolute";
			let figureX = (vx + x2 - x1) + "px";
			let figureY = (vy + y2 - y1) + "px";
			currentElFigure.style.left = figureX;
			currentElFigure.style.top = figureY;
		};
	}
	this.elMoveBtn.addEventListener("touchstart", ev => this.moveBtnTouchstart(ev), false);
	this.moveBtnTouchstart = function (event) {
		layout.switchToAbsoluteLayout();
		event.preventDefault(); // no additional mouse-events
		var viewportWidth = window.innerWidth;
		var rectVideo = this.elVideo.getBoundingClientRect();
		vx = rectVideo.x + window.scrollX;
		vy = rectVideo.y + window.scrollY;
		let touch = event.changedTouches[0];
		x1 = touch.pageX;
		y1 = touch.pageY;
		console.log("TouchStart: (%s, %s) - (%s, %s)", vx, vy,
				x1, y1);
		messages.showMessage($.i18n("touchstart box $1: ($2, $3)", nr, x1, y1));
	};
	this.elMoveBtn.addEventListener("touchend", ev => this.moveBtnTouchend(ev), false);
	this.moveBtnTouchend = function (event) {
		let touch = event.changedTouches[0];
		let x2 = touch.pageX;
		let y2 = touch.pageY;
		console.log("touchend box %s: (%s, %s)", nr, x2, y2);
	};
	this.elMoveBtn.addEventListener("touchcancel", ev => this.moveBtnTouchcancel(ev), false);
	this.moveBtnTouchcancel = function (event) {
		let x2 = touch.pageX;
		let y2 = touch.pageY;
		console.log("touchcancel box %s: (%s, %s)", nr, x2, y2);
	};
	this.elMoveBtn.addEventListener("touchleave", ev => this.moveBtnTouchleave(ev), false);
	this.moveBtnTouchleave = function (event) {
		let x2 = touch.pageX;
		let y2 = touch.pageY;
		console.log("touchleave box %s: (%s, %s)", nr, x2, y2);
	};
	this.elMoveBtn.addEventListener("touchmove", ev => this.moveBtnTouchmove(ev), false);
	this.moveBtnTouchmove = function (event) {
		let touch = event.changedTouches[0];
		let x2 = touch.pageX;
		let y2 = touch.pageY;
		this.elFigure.style.position = "absolute";
		let figureX = (vx + x2 - x1) + "px";
		let figureY = (vy + y2 - y1) + "px";
		this.elFigure.style.left = figureX;
		this.elFigure.style.top = figureY;
	};

	this.elLayerUpBtn.addEventListener("click", ev => this.layerUpBtnClicked());
	this.layerUpBtnClicked = function() {
		let zIndex = this.elFigure.style.zIndex;
		if (!zIndex || zIndex == "") {
			zIndex = 4;
		}
		zIndex++;
		console.log("videobox %s: layer-up, z-index=%s", nr, zIndex);
		this.elFigure.style.zIndex = zIndex;
	};
	this.elLayerDownBtn.addEventListener("click", ev => this.layerDownBtnClicked());
	this.layerDownBtnClicked = function() {
		let zIndex = this.elFigure.style.zIndex;
		if (!zIndex || zIndex == "") {
			zIndex = 4;
		}
		if (zIndex == 0) {
			messages.showMessage($.i18n("VideoBox $1 („$2“) hat die unterste Ebene erreicht.", nr, this.elUser.value));
		}
		else {
			zIndex--;
		}
		console.log("videobox %s: layer-down, z-index=%s", nr, zIndex);
		this.elFigure.style.zIndex = zIndex;
	};

	this.elZoomInBtn.addEventListener("click", ev => this.zoomInBtnClicked());
	this.zoomInBtnClicked = function() {
		var viewportWidth = window.innerWidth;
		let widthOld = this.elVideo.clientWidth;
		let widthNew = widthOld * 1.1;
		if (widthNew <= viewportWidth) {
			this.elVideo.style.width = widthNew + "px";
			console.log("change width: %s -> %s", widthOld, this.elVideo.clientWidth);
		}
	};

	this.elZoomOutBtn.addEventListener("click", ev => this.zoomOutBtnClicked());
	this.zoomOutBtnClicked = function() {
		var viewportWidth = window.innerWidth;
		let widthOld = this.elVideo.clientWidth;
		let widthNew = widthOld / 1.1;
		if (widthNew > 0) {
			this.elVideo.style.width = widthNew + "px";
			console.log("change width: %s -> %s", widthOld, this.elVideo.clientWidth);
		}
	};

	this.elExitBtn.addEventListener("click", ev => this.exitBtnClicked());
	this.exitBtnClicked = function() {
		console.log("elExitBtn: localNr=%s, isLocalStream=%s", nr, isLocalStream);
		if (isLocalStream) {
			this.refreshVideoBoxBoolean(true, 'hangup', "Aufgelegt");
			stopVideoLocal(mapNrVideoBox[nr]);
			handleLogout(mapNrVideoBox[nr]);
		}
		else {
			var curPeerName = this.elUser.value.toLowerCase().replace(/[ ,.'-]/g,'');
			if (mapPeerNameVideoBox[curPeerName]) {
				stopVideoRemote(curPeerName);
				delete mapPeerNameVideoBox[curPeerName];
			}
		}
		delete mapNrVideoBox[nr];
		this.elFigure.parentNode.removeChild(this.elFigure);
	};

}

function handleLogin(boxType, name, nr) {
	let session = $('#sessionId').value;
	if (name.length == 0) {
		messages.showMessage($.i18n("Bitte einen eigenen Namen festlegen."));
	}
	else if (session.length == 0) {
		messages.showMessage($.i18n("Bitte die Session-Id angeben."));
	}
	else {
		let videoBoxLocal = searchVideoBoxByName(name);
		if (videoBoxLocal == null) {
			messages.showMessage($.i18n("Zum Namen „$1“ wurde keine Video-Box gefunden.", name));
		}
		else {
			videoBoxLocal.elUser.readOnly = true;
			wsManager.send({
				type: "login",
				boxType: boxType,
				localNr: nr,
				name: name,
				session: session
			});
		}
	}
}

function handleLogout(videoBoxLocal) {
	let session = $('#sessionId').value;
	let name = videoBoxLocal.elUser.value;
	if (name != '' && session != '') {
		wsManager.send({
			type: "logout",
			boxType: videoBoxLocal.boxType,
			localNr: videoBoxLocal.nr,
			name: name,
			session: session
		});
	}
}

function handleMessage(message) {
	console.log("Servernachricht: %s", message.data);
	let data = JSON.parse(message.data);
	switch (data.type) {
	case "connect":
		if (data.success && data.session) {
			if ($('#sessionId').value.trim() == "") {
				$('#sessionId').value = data.session;
			}
		}
		// There are no i18n-translations directly after connect.
		messages.showMessage(`${data.msg}`);
		break;
	case "login":
		onLogin(data.success, data.msg, data.boxType, data.name, data.localNr);
		break;
	case "relogin":
		messages.showMessage($.i18n(data.msg));
		break;
	case "requestCall":
		onRequestCall(data.peer, data.name, data.localNr, data.success, data.msg, data.boxType);
		break;
	case "rejectCall":
		onRejectCall(data.peer, data.peerNr, data.name, data.success, data.msg);
		break;
	case "offer":
		if (data.offer) {
			onOffer(data.offer, data.peer, data.peerNr, data.name, data.localNr);
		}
		else {
			messages.showMessage(`offer-event without offer-data: ${data.msg}`);
		}
		break;
	case "answer":
		onAnswer(data.answer, data.peer, data.peerNr, data.name, data.localNr);
		break;
	case "candidate":
		if (data.candidate) {
			onCandidate(data.candidate, data.peer, data.peerNr, data.name, data.localNr);
		}
		else {
			messages.showMessage($.i18n("Der ICE-Handshake mit $1 war nicht erfolgreich.", data.name));
		}
		break;
	case "dictionary":
		onDictionary(data.lang, data.dictionary, data.msg);
		break;
	case "leave":
		onLeave(data.peer, data.peerNr, data.name, data.localNr);
		break;
	case "logout":
		onLogout(data.name, data.msg);
		break;
	default:
		messages.showMessage(`Unknown message of type ${data.type}`);
		if (data.msg) {
			messages.showMessage(`Error-message of the server: ${data.msg}`);
		}
		else {
			messages.showMessage(`U: ${data.msg}`);
		}
		break;
	}
}

/**
 * Video-Box initialisieren mit Remote-Verbindung.
 * @param name eigener Name
 * @param nr Nummer der Video-Box zur Anzeige des Streams des entfernten Teilnehmers
 * @param peerName Name des entfernten Teilnehmers
 * @param peerNr Nummer der Video-Box des entfernten Teilnehmers
 */
function initVideoBoxConnectionZuPeer(name, nr, peerName, peerNr) {
	let sessionId = $('#sessionId').value;
	let videoBox = mapNrVideoBox[nr];
	let boxType = videoBox.boxType;
	let elUser = videoBox.elUser;
	let elFigure = videoBox.elFigure;
	let elVideo = videoBox.elVideo;
	let elHangupBtn = videoBox.elHangupBtn;
	elUser.value = peerName;
	elUser.readonly = true;
	mapPeerNameVideoBox[peerName] = videoBox;

	console.log("initVideoBoxConnectionZuPeer: name=%s, nr=%d, boxType=%d, peerName=%s, peerNr=%s",
			name, nr, boxType, peerName, peerNr);
	let videoBoxRtcConnection = new VideoBoxRTCPeerConnection(name, nr, peerName, peerNr, sessionId);
	let videoBoxLocalContent = searchVideoBoxByName(name);
	console.log('videoBoxLocalContent: localContent nr=%s boxType=%s', videoBoxLocalContent.nr, videoBoxLocalContent.boxType);
	if (videoBoxLocalContent) {
		let peerKey = peerName + '.' + peerNr;
		let hasVideoStream = videoBoxLocalContent.videoLocal;
		console.log('videoBoxLocalContent: localContent hasVS=%s, lV=%s, peerKey=%s',
				hasVideoStream, videoBoxLocalContent.videoLocal, peerKey);
		if (hasVideoStream) {
			addVideoLocal(videoBoxLocalContent, videoBoxRtcConnection.rtcConnection);
		}
		else {
			console.log("addTransceiver/video: name=%s, nr=%d, boxType=%d, peerName=%s, peerNr=%s",
					name, nr, boxType, peerName, peerNr);
			videoBoxRtcConnection.rtcConnection.addTransceiver("video");
		}
	}
	else {
		console.log(`initVideoBoxConnectionZuPeer: peerName=%s, no videoBoxLocalContent`,
				peerName);
	}
}

/**
 * Constructor of a WebRTC-Connection to a remote user.
 * 
 * @param name
 *            own name
 * @param nr number of video-box
 * @param peerName
 *            name of remote user
 * @param peerNr number of peer's video-box
 * @param sessionId
 *            common session-id
 *           
 * @return RTCPeerConnection
 */
function VideoBoxRTCPeerConnection(name, nr, peerName, peerNr, sessionId) {
	console.log("VideoBoxRTCPeerConnection: name=%s, nr=%s, peerName=%s, peerNr=%s, sessionId=%s",
			name, nr, peerName, peerNr, sessionId);
	this.videoBox = mapNrVideoBox[nr];
	if (!this.videoBox) {
		console.error("initRTCPeerConnection: name=%s, nr=%s, peerName=%s, peerNr=%s, nr unbekannt",
				name, nr, peerName, peerNr);
		return;
	}
	this.videoBox.localName = name;
	this.videoBox.peerName = peerName;
	this.videoBox.peerNr = peerNr;
	let boxType = this.videoBox.boxType;
	let elUser = this.videoBox.elUser;
	let elFigure = this.videoBox.elFigure;
	let elRemoteVideo = this.videoBox.elVideo;
	let elHangupBtn = this.videoBox.elHangupBtn;

	delete this.videoBox.messages[MSG_KEY_BOX_TYPE];
	this.videoBox.showVideoBoxMessages(false);

	// STUN-Server of ab32.de in Helsinki.
	let configuration = {
		"iceServers": [ { urls: "stun:stun0.ab32.de:3478" }, { urls: "stun:stun1.ab32.de:3479" }]
	};
	console.log("ICE-Server: %o", configuration);
	this.rtcConnection = new RTCPeerConnection(configuration);
	this.rtcConnection.addEventListener("negotiationneeded", ev => this.handleNegotiationNeededEvent());
	// No support of rtcConnection.onconnectionstatechange in Firefox (2020-06-07).
	this.rtcConnection.addEventListener("icecandidate", ev => this.handleICECandidateEvent(ev));
	this.rtcConnection.addEventListener("iceconnectionstatechange", ev => this.handleICEConnectionStateChangeEvent(ev));
	this.rtcConnection.addEventListener("signalingstatechange", ev => this.handleSignalingStateChangeEvent(ev));
	this.rtcConnection.addEventListener("track", ev => this.handleTrackEvent(ev));
	var peerKey = peerName + '.' + peerNr;
	rtcConnections[peerKey] = this;

	new DataChannel(this.videoBox, name, peerName, peerNr);
	
	/**
	 * Create an offer and send it to the peer user.
	 */
	this.handleNegotiationNeededEvent = function() {
		console.log(`VideoBox ${nr}, handleNegotiationNeededEvent: peerName=${peerName}, peerNr=${peerNr}, hasRemoteDescr=${this.hasRemoteDescription}`);
		if (this.hasRemoteDescription) {
			console.log("handleNegotiationNeeded: remoteDescription already available.");
		}
		else {
			var lRtcConnection = this.rtcConnection;
			this.rtcConnection.createOffer({iceRestart: true}).then(function (offer) {
				console.log(`handleNegotiationNeededEvent: offer created`); 
				return lRtcConnection.setLocalDescription(offer);
			})
			.then(function() {
				console.log('click/send offer: localDesc=%s', JSON.stringify(lRtcConnection.localDescription)); 
				wsManager.send({ 
					type: "offer",
					offer: lRtcConnection.localDescription,
					name: name,
					localNr: nr,
					peer: peerName,
					peerNr: peerNr,
					session: sessionId
				});
			}) 
			.catch(function (err) {
				console.log("click/offer-Details: %s", err);
				messages.showMessage(`Error after offering own stream to ${peerName}: ${err}`);
				throw err;
			});
		}
	}

	this.handleICEConnectionStateChangeEvent = function(event) {
		console.log("VideoBox %s: ICE connection %s state changed to %s",
				nr, peerName, this.rtcConnection.iceConnectionState);
		switch(this.rtcConnection.iceConnectionState) {
			case "completed":
				break;
			case "closed":
			case "failed":
				messages.showMessage($.i18n("Keine Verbindung zu $1 bekommen: ICE $2",
						peerName, this.rtcConnection.iceConnectionState));
				closeVideoCall(peerName, peerNr, this, elRemoteVideo, elHangupBtn);
				break;
			case "disconnected":
				// This could be temporarily because of a "Consent Freshness" (RFC 7675) check.
				break;
	    }
	}
	
	/**
	 * Relay an ICE-Candidate-Event.
	 */
	this.handleICECandidateEvent = function(event) {
		if (event.candidate) {
			console.log("VideoBox %s: send ICE-candidate zu %s; %s", nr, peerName, event.candidate);
			messages.showMessage($.i18n("Kanalaushandlung: Sende Kandidat $1", event.candidate.candidate));
			wsManager.send({
				type: "candidate",
				candidate: event.candidate,
				name: name,
				localNr: nr,
				peer: peerName,
				peerNr: peerNr,
				session: sessionId
			});
		}
		else {
			console.log("VideoBox %s: All ICE candidates haven been sent.", nr);
		}
	}
	
	this.handleICEGatheringStateChangeEvent = function(event) {
		console.log("ICEGatheringStateChangeEvent zu %s: %s", peerName, event);
	}
	
	this.handleSignalingStateChangeEvent = function(event) {
		console.log("VideoBox %s, signalStateChanged: peer=%s, ev=%s", nr, peerName, this.rtcConnection.signalingState);
		switch(this.rtcConnection.signalingState) {
		case "closed":
			closeVideoCall(peerName, peerNr, this, elRemoteVideo, elHangupBtn);
			break;
		}
	}
	
	this.handleTrackEvent = function(event) {
		console.log(`handleTrackEvent: nr=${this.videoBox.nr}, event=${event}`);
		if (!elRemoteVideo) {
			throw "Can't find remote-video-Element.";
		}
		if (event.streams == null || event.streams.length == 0) {
			throw "handleTrackEvent without stream.";
		}
		let stream = event.streams[0]; // type MediaStream
		let tracks = stream.getVideoTracks();
		let aspectRatio = 0;
		if (tracks && tracks.length > 0) {
			let track = tracks[0]; // type MediaStreamTrack
			let settings = track.getSettings(); // type MediaTrackSettings
			console.log("ontrack/remoteVideo: stream=%s, t=%s, s=%s, w=%s, h=%s", stream,
					track, settings, settings.width, settings.height);
		}
		else {
			console.log("ontrack/remoteVideo: stream=%s", stream);
		}
		elRemoteVideo.srcObject = stream;
		elHangupBtn.disabled = false;
		if (aspectRatio > .1 && aspectRatio < 10) {
			elFigure.style.height = elFigure.style.width / aspectRatio;
		}
		
		messages.showMessage($.i18n("Remote-Video von $1 wird angezeigt.", peerName));
	}
	
	this.handleRemoveTrackEvent = function(event) {
		let trackList = remoteStream.getTracks();
		if (trackList.length == 0) {
			closeVideoCall(peerName, peerNr, this, elRemoteVideo, elHangupBtn);
		}
	}
}

/**
 * Creates a data-channel within the RTC-connection.
 * On open the data-channel will be stored in the map rtcChannels with key peerKey.
 * @param videoBox video-box
 * @param name local name
 * @param peerName peer-name
 * @param peerNr peer-nr
 */
function DataChannel(videoBox, name, peerName, peerNr) {
	var peerKey = peerName + '.' + peerNr;
	var rtcConnection = rtcConnections[peerKey].rtcConnection;
	console.log(`DataChannel: init name=${name}, localNr=${videoBox.nr}, peerName=${peerName}, peerNr=${peerNr}`);

	this.channel = rtcConnection.createDataChannel("data", {negotiated: true, id: 0});
	
	this.channel.addEventListener("open", ev => this.channelOnOpen());
	this.channel.addEventListener("close", ev => this.channelOnClose());
	this.channel.addEventListener("error", ev => this.channelOnError(ev));
	this.channel.addEventListener("message", ev => this.channelOnMessage());
	
	rtcChannels[peerKey] = this;

	this.channelOnOpen = function () {
		let videoBoxLocal = searchVideoBoxByName(name);
		if (videoBoxLocal) {
			videoBoxLocal.showVideoBoxMessages(true);
		}
		else {
			console.error('channelOnOpen: name=%s, videoBoxLocal is missing', name);
		}
		sendDataBroadcast(name, {type: 'chat', name: name, msg: 'joined', isGenerated: true});
	};
	this.channelOnClose = function() {
		console.log(`DataChannel: closed name=${name}, localNr=${videoBox.nr}, peerName=${peerName}, peerNr=${peerNr}`);
		delete rtcChannels[peerKey];
	};
	this.channelOnError = function(ev) {
		let err = ev.error;
		console.log(`channelOnError: name=${name}, peerName=${peerName}, peerNr=${peerNr}, error=%s`, err.message);
	};
	this.channelOnMessage = function() {
		let data = JSON.parse(event.data);
		if (data.type == 'chat') {
			let msg = `Nachricht von ${peerName}: ${data.msg}`;
			console.log(msg);
			let videoBoxChat = searchVideoBoxByType(BOX_TYPE_CHAT);
			if (videoBoxChat) {
				videoBoxChat.addChatMessage(data, peerName);
			}
			else {
				messages.showMessage(msg);
			}
		}
		else if (data.type == 'videoBoxStatus') {
			let mapMsgs = videoBox.messages;
			mapMsgs['videoBoxStatus'] = data.status;
			videoBox.showVideoBoxMessages(false);
		}
		else {
			console.log("Unknown data-message with type ${data.type}: ${event.data}");
		}
	};
}

function onLogin(success, msg, boxType, name, nr) {
	console.log("onLogin: success=%s, boxType=%s, nr=%s, msg=%s", success, boxType, nr, msg);
	if (success === false) {
		let videoBoxLocal = searchVideoBoxByName(name);
		if (videoBoxLocal) {
			videoBoxLocal.elUser.readOnly = false;
		}
		if (msg) {
			messages.showMessage($.i18n(msg));
		}
		else {
			messages.showMessage($.i18n("Der LOGIN ($1) war nicht erfolgreich: $2", name, "(?)"));
		}
	}
	else {
		if (msg) {
			messages.showMessage($.i18n(msg));
		}
		else {
			messages.showMessage($.i18n("Der LOGIN ($1) war erfolgreich: $2", name, "(-)"));
		}
		startVideoLocal(boxType, name, nr);
		$$('.controls button').forEach((el) => el.style.display = "block");
		
		// Wir bieten direkt ein zweites Fenster an.
		new VideoBox(boxType, BOX_REMOTE, null, null, null);
	}
}

function onRequestCall(name, peerName, peerNr, isSuccess, msg, boxType) {
	if (isSuccess) {
		let callTypeDisplay;
		if (boxType == BOX_TYPE_VIDEO) {
			callTypeDisplay = "Video-Anfruf";
		}
		else if (boxType == BOX_TYPE_SCREEN) {
			callTypeDisplay = "Geteiltes Fenster"
		}
		else if (boxType == BOX_TYPE_CHAT) {
			callTypeDisplay = "Textchat"
		}
		else if (boxType == BOX_TYPE_REQUEST) {
			callTypeDisplay = "Stream-Anfrage"
		}
		else {
			console.error("Unknown boxType (%s) by (%s)", boxType, peerName);
			return;
		}
		if (confirm($.i18n("Klingeling! $1 von „$2“ an „$3“ annehmen?", $.i18n(callTypeDisplay), peerName, name))) {
			let boxFound = false;
			for (let nr in mapNrVideoBox) {
				let videoBox = mapNrVideoBox[nr];
				let elUser = videoBox.elUser;
				if ((elUser.value == "" || simplifyName(elUser.value) == simplifyName(name))
						&& !videoBox.isActive
						&& ((videoBox.boxType == BOX_TYPE_REQUEST && boxType != BOX_TYPE_CHAT)
							|| videoBox.boxType == boxType)) {
					initVideoBoxConnectionZuPeer(name, nr, peerName, peerNr);
					boxFound = true;
					break;
				}
			}
			if (!boxFound) {
				new VideoBox(boxType, BOX_REMOTE, name, peerName, peerNr);
			}
		}
		else {
			messages.showMessage(`Verbindung von ${peerName} abgelehnt.`);
			wsManager.send({ 
				type: "rejectCall",
				name: name,
				peer: peerName,
				peerNr: peerNr,
				session: $('#sessionId').value
			});
		}
	}
	else {
		let videoBox = mapPeerNameVideoBox[name];
		if (videoBox) {
			videoBox.elUser.readOnly = false;
			videoBox.peerName = null;
			videoBox.peerNr = null;
		}
		messages.showMessage(msg);
	}
}

function onRejectCall(name, localNr, peerName, isSuccess, msg) {
	messages.showMessage($.i18n("Der Anfruf wurde von „$1“ nicht angenommen.", peerName));
	let videoBox = mapNrVideoBox[localNr];
	if (videoBox) {
		videoBox.elUser.readOnly = false;
		videoBox.peerName = null;
		videoBox.peerNr = null;
	}
}

function onAnswer(answer, name, localNr, peerName, peerNr) {
	console.log("onAnswer: name=%s, localNr=%s, peerName=%s, peerNr=%s, answer=%s",
			name, localNr, peerName, peerNr, answer);
	let desc = new RTCSessionDescription(answer);
	var sessionId = $('#sessionId');
	let videoBox = mapPeerNameVideoBox[peerName];
	var elHangupBtn = videoBox.elHangupBtn;
	var elRemoteVideo = videoBox.elVideo;
	var peerKey = peerName + '.' + peerNr;
	let videoBoxRtcConn = rtcConnections[peerKey];
	let rtcConnection = videoBoxRtcConn.rtcConnection;
	console.log("onAnswer: peerKey=%s, setRemoteDescription", peerKey);
	videoBoxRtcConn.hasRemoteDescription = true;
	rtcConnection.setRemoteDescription(desc)
	.catch(function(err) {
		console.log("onAnswer-Error: %o", err);
		messages.showMessage(`Error while answering a connection: ${err}`);
		throw err;
	});
	messages.showMessage($.i18n("Video-Call von „$1“ wurde beantwortet.", peerName));
}

/**
 * Someone calls us. We respond.
 * 
 * @param offer
 *            RTC-offer
 * @param peerName
 *            name of the peer user
 */
function onOffer(offer, name, localNr, peerName, peerNr) {
	messages.showMessage(`Video-Call-Angebot von „${peerName}“`);
	console.log("onOffer: name=%s, peerName=%s", name, peerName);
	let desc = new RTCSessionDescription(offer);
	var sessionId = $('#sessionId').value;
	
	let videoBox = mapPeerNameVideoBox[peerName];
	var elHangupBtn = videoBox.elHangupBtn;
	var elFigure = videoBox.elFigure;
	var elRemoteVideo = videoBox.elVideo;
	var videoBoxRtcConnection = new VideoBoxRTCPeerConnection(name, localNr, peerName, peerNr, sessionId);
	let rtcConnection = videoBoxRtcConnection.rtcConnection;
	console.log("peerName=%s, before setRemoteDescription in onOffer", peerName);
	videoBoxRtcConnection.hasRemoteDescription = true;
	rtcConnection.setRemoteDescription(desc).then(function() {
		// Add our local stream.
		let videoBoxLocalContent = searchVideoBoxByName(name);
		if (!videoBoxLocalContent) {
			throw `onOffer: No local video-box of \"${name}\"`;
		}
		addVideoLocal(videoBoxLocalContent, rtcConnection);
	})
	.then(function() {
		return rtcConnection.createAnswer();
	})
	.then(function(answer) {
		return rtcConnection.setLocalDescription(answer);
	})
	.then(function() {
		console.log("createdAnswer: localDesc=%s", JSON.stringify(rtcConnection.localDescription));
		wsManager.send({
			type: "answer",
			answer: rtcConnection.localDescription,
			name: name,
			localNr: localNr,
			peer: peerName,
			peerNr: peerNr,
			session: sessionId
		});
		console.log("createAnswer: answer has been sent");
		messages.showMessage($.i18n("Video-Call von „$1“ wurde beantwortet.", peerName));
	})
	.catch(function(err) {
		console.log("onOffer-Error: %s", err);
		messages.showMessage(`Error while answering a request of ${peerName} whose video-box has number ${peerNr}: ${err}`);
		throw err;
	});
}

/**
 * Receive an ICE of the peer.
 * 
 * @param candidate
 *            ICE-candidate
 */
function onCandidate(candidate, name, localNr, peerName, peerNr) {
	console.log("onCandidate: %s %s", peerName, candidate.candidate);
	messages.showMessage($.i18n("ICE-Vorschlag von $1: $2", peerName, candidate.candidate));
	let peerKey = peerName + '.' + peerNr;
	let videoBoxRtcConnection = rtcConnections[peerKey];
	if (!videoBoxRtcConnection) {
		console.error("onCandidate: peerName=%s, peerNr=%s, unknown rtcConnection", peerName, peerNr);
		return;
	}
	let rtcConnection = videoBoxRtcConnection.rtcConnection;
	rtcConnection.addIceCandidate(new RTCIceCandidate(candidate));
}

function onDictionary(lang, dictionary, msg) {
	if (msg) {
		messages.showMessage($.i18n(msg));
	}
	else if (lang && dictionary) {
		i18n.load(lang, JSON.parse(dictionary));
	}
}

function onLeave(name, localNr, peerName, peerNr) {
	let peerKey = peerName + '.' + peerNr;
	let videoBox = mapPeerNameVideoBox[peerKey];
	var videoBoxRtcConnection = rtcConnections[peerKey];
	if (videoBox && videoBoxRtcConnection) {
		var elHangupBtn = videoBox.elHangupBtn;
		var elRemoteVideo = videoBox.elVideo;
		closeVideoCall(peerName, peerNr, videoBoxRtcConnection, elRemoteVideo, elHangupBtn);
		
		let mapMsgs = videoBox.messages;
		mapMsgs['hangup', `„${peerName}“ hat aufgelegt`];
		videoBox.showVideoBoxMessages(false);
	}
}

function onLogout(name) {
	let videoBox = searchVideoBoxByName(name);
	if (videoBox) {
		stopVideoLocal(videoBox);
	}
}

function closeVideoCall(peerName, peerNr, videoBoxRtcConnection, remoteVideo, elHangupBtn) {
	messages.showMessage($.i18n("Video-Call zu „$1“ wird beendet.", peerName));
	console.log("closeVideoCall: peerName=%s, rv=%s, rtcConnection=%s", peerName, remoteVideo, videoBoxRtcConnection);
	
	if (videoBoxRtcConnection) {
		let rtcConnection = videoBoxRtcConnection.rtcConnection;
		rtcConnection.ontrack = null;
		rtcConnection.onremovetrack = null;
		rtcConnection.onremovestream = null;
		rtcConnection.onicecandidate = null;
		rtcConnection.oniceconnectionstatechange = null;
		rtcConnection.onsignalingstatechange = null;
		rtcConnection.onicegatheringstatechange = null;
		rtcConnection.onnegotiationneeded = null;
	}
	
	if (remoteVideo.srcObject) {
		remoteVideo.srcObject.getTracks().forEach(track => track.stop());
	}
	
	if (videoBoxRtcConnection) {
		let rtcConnection = videoBoxRtcConnection.rtcConnection;
		if (rtcConnection.close) {
			rtcConnection.close();
		}
		else {
			console.log("closeVideoCall: rtcConnection=%s, rtcConnection without close", rtcConnection);
		}
	}
	
	remoteVideo.removeAttribute("src");
	remoteVideo.removeAttribute("srcObject");

	if (elHangupBtn) {
		elHangupBtn.disabled = true;
	}
	else {
		console.error("closeVideoCall: peerName=%s, rv=%s, elHangupBtn == null", peerName, remoteVideo);
	}
	let peerKey = peerName + '.' + peerNr;
	delete rtcConnections[peerKey];
}

/**
 * Manager of the web-socket-session.
 *  
 * @param webSocketUrl URL of the web-socket
 * @param handleMessageFunction function to handle incoming messages
 */
function WebSocketSessionManager(webSocketUrl, handleMessageFunction) {
	console.log('WebSocketSessionManager: URL=%s', webSocketUrl);
	
	this.tsConnectionInit = null;
	this.connection = null;

	this.close = function() {
		if (this.connection && this.connection.readyState == WebSocket.OPEN) {
			messages.showMessage($.i18n("Es erfolgt eine Abmeldung beim Server."));
			this.connection.close();
		}
	}

	this.handleOpen = function(onOpenFunction) {
		console.log('WebSocket: open');

		this.connection.onmessage = handleMessageFunction;
		if (onOpenFunction) {
			onOpenFunction();
		}
	};
	this.handleError = function(event) {
		messages.showMessage(`Can't open web-socket connection: ${event}`);
		console.log(`WebSocket: error ${event}`);
	};
	this.handleClose = function() {
		console.log('WebSocketConnection %s closed', this.connection);
		let activeVideoBox = null;
		for (let nr in mapNrVideoBox) {
			if (mapNrVideoBox[nr].isActive) {
				// There is some active videobox.
				activeVideoBox = mapNrVideoBox[nr];
			}
		}
		if (activeVideoBox) {
			let connectionAge = new Date() - this.tsConnectionInit;
			if (connectionAge > 15000) {
				console.log("Baue WebSocket-Session neu auf");
				var thisVideoBox = this;
				this.initWebSocket(function() {
					thisVideoBox.sendRelogin(activeVideoBox);
				});
			}
			else {
				console.log("Es gibt aktive Videoboxen, aber die WebSocket-Session wurde erst kürzlich neu aufgebaut");
				messages.showMessage($.i18n("Eine junge Verbindung zum Server wurde unterbrochen. Vielleicht ist der Server überlastet? Bitte ein wenig warten oder andere Dinge tun."));
			}
		}
	};

	this.initWebSocket = function(onOpenFunction) {
		if (this.connection) {
			this.connection.close();
		}
		
		this.tsConnectionInit = new Date();
		this.connection = new WebSocket(webSocketUrl);
		this.connection.addEventListener('open', ev => this.handleOpen(onOpenFunction));
		this.connection.addEventListener('error', ev => this.handleError(ev));
		this.connection.addEventListener('close', ev => this.handleClose());
	};

	this.initWebSocket(function() {
		i18n.request(i18n.lang);
	});

	this.sendChecked = function(message) {
		if (message.session != $('#sessionId').value) {
			console.error("Session-Id != '%s': %o", $('#sessionId').value, message);
			message.session = $('#sessionId').value;
		}
		console.log("send: type=%s, name=%s, nr=%s, peer=%s, peerNr=%s, session=%s, lang=%s, ...",
				message.type, message.name, message.localNr,
				message.peer, message.peerNr,
				message.session, message.lang);
		this.connection.send(JSON.stringify(message)); 
	};

	this.send = function(message) {
		if (this.connection && this.connection.readyState == WebSocket.OPEN) {
			this.sendChecked(message);
		}
		else {
			let connectionAge = new Date() - this.tsConnectionInit;
			if (connectionAge > 5000) {
				console.log('send reconnection: msg.type=%s, age=%d ms', message.type, connectionAge);
				messages.showMessage($.i18n("Neuaufbau der Verbindung zum Server ..."));
				this.initWebSocket(function() {
					sendChecked(message);
				});
			}
			else {
				messages.showMessage($.i18n("Nachricht vom Typ \"$1\" kann wegen fehlender Server-Verbindung nicht gesendet werden.", message.type));
			}
		}
	};

	this.sendRelogin = function(videoBox) {
		let session = $('#sessionId').value;
		let name = videoBox.localName;
		if (sessionId == '') {
			console.error("sendRelogin: sessionId nicht gesetzt");
		}
		else if (!name || name == '') {
			console.error("sendRelogin: localName in videoBox[%s] == null", videoBox.nr);
		}
		else {
			console.log("sendRelogin: name=%s, session=%s", name, session);
			this.send({
				type: "relogin",
				name: name,
				session: session
			});
		}
	}
}

/**
 * Sends a broadcast to the peers of the video-boxes having the given localName
 * @param localName local name
 * @param data JSON-Data
 */
function sendDataBroadcast(localName, data) {
	// Find the peer-keys of the video-boxes with given localName.
	let sPeerKeys = "";
	let setPeerKeys = {};
	for (let nr in mapNrVideoBox) {
		let videoBox = mapNrVideoBox[nr];
		if (videoBox.localName
				&& (simplifyName(videoBox.localName) == simplifyName(localName))
				&& !videoBox.isLocalStream) {
			let peerKey = videoBox.peerName + '.' + videoBox.peerNr;
			setPeerKeys[peerKey] = true;
			if (sPeerKeys.length > 0) {
				sPeerKeys += ', ';
			}
			sPeerKeys += peerKey;
		}
	}

	// Send a broadcast to the corresponding peer-keys.
	let sJsonData = JSON.stringify(data);
	console.log('sendDataBrodcast: localName=%s, data=%s, peerKeys=%s', localName, sJsonData, sPeerKeys);

	for (let peerKey in rtcChannels) {
		if (setPeerKeys[peerKey]) {
			let dataChannel = rtcChannels[peerKey];
			if (dataChannel) {
				console.log(`Sende Nachricht an "${peerKey}": ${data}`);
				dataChannel.channel.send(sJsonData);
			}
			else {
				console.log(`Der Data-Channel zu Peer "${peerKey}" ist nicht vorhanden.`);
			}
		}
	}
}

/**
 * Layout-controller.
 */
function LayoutVideoBoxes() {
	// true, if the windows are positioned by absolute layout. 
	this.isAbsoluteLayout = false;
	
	this.autoResize = function() {
		this.switchToAbsoluteLayout();
		this.removeButtonVisibility();
		
		function isInside(r1x1, r1x2, r2x1, r2x2) {
			return ((r1x1 < r2x1)              && (r2x1            < r1x2)) // r2x1 inside?
				|| ((r1x1 < r2x2)              && (r2x2            < r1x2)) // r2x2 inside?
				|| ((r1x1 < (r2x1 + r2x2) / 2) && ((r2x1 + r2x2)/2 < r1x2)) // (r2x1+r2x2)/2 inside?
				|| ((r2x1 < r1x1)              && (r1x1            < r2x2)) // r1x1 inside?
				|| ((r2x1 < r1x2)              && (r1x2            < r2x2)) // r1x2 inside?
				|| ((r2x1 < (r1x1 + r1x2) / 2) && ((r1x1 + r1x2)/2 < r2x2)) // (r1x1+r1x2)/2 inside?
		}
		
		let rectMenuIcon = $('#menu').getBoundingClientRect();
		var vpMinY = rectMenuIcon.y + rectMenuIcon.height;
		var vpWidth = window.innerWidth;
		var vpHeight = window.innerHeight;
		var numStep = 0;
		var maxStep = 75;
		var dt = 1.5;
		var millisWait = 50;
		let currentPos = {};
		for (let nr in mapNrVideoBox) {
			let videoBox = mapNrVideoBox[nr];
			let rectVideo = videoBox.getBoundingClientRect();
			let vx = rectVideo.x;
			let vy = rectVideo.y;
			let wx = vx + rectVideo.width;
			let wy = vy + rectVideo.height;
			currentPos[nr] = [
					{x: vx, y: vy, vx: 0, vy: 0, ax: 0, ay: 0},
					{x: wx, y: wy, vx: 0, vy: 0, ax: 0, ay: 0}];
		}
		var doPhysics = function() {
			console.log("autoResize1: numStep=%s, w=%s, h=%s, currentPos=%s", numStep, vpWidth, vpHeight, JSON.stringify(currentPos));
			// rectangle-physics-engine ;-).
			for (let nr in currentPos) {
				let cp = currentPos[nr];
				// expand itself
				let a = [{x: -1, y: -1}, {x: 1, y: 1}];
				// window-border
				if (cp[0].x < 0) {
					a[0].x += 2;
				}
				if (cp[1].x > vpWidth) {
					a[1].x -= 2;
				}
				if (cp[0].y < vpMinY) {
					a[0].y += 2;
				}
				if (cp[1].y > vpHeight) {
					a[1].y -= 2;
				}
				// respect each other
				for (let nrOther in currentPos) {
					if (nr != nrOther) {
						let cpOther = currentPos[nrOther];
						if (isInside(cp[0].y, cp[1].y, cpOther[0].y, cpOther[1].y)) {
							if (cp[1].x > cpOther[0].x && cp[1].x <= cpOther[1].x) {
								a[1].x = -2;
							}
							else if (cp[0].x > cpOther[0].x && cp[0].x <= cpOther[1].x) {
								a[0].x = +2;
							}
						}
						if (isInside(cp[0].x, cp[1].x, cpOther[0].x, cpOther[1].x)) {
							if (cp[1].y > cpOther[0].y && cp[1].y <= cpOther[1].y) {
								a[1].y = -2;
							}
							else if (cp[0].y > cpOther[0].y && cp[0].y <= cpOther[1].y) {
								a[0].y = +2;
							}
						}
					}
				}
				for(let i = 0; i < 2; i++) {
					cp[i].ax = a[i].x;
					cp[i].ay = a[i].y;
					cp[i].vx += a[i].x * dt;
					cp[i].vy += a[i].y * dt;
				}
			}
			for (let nr in currentPos) {
				let cp = currentPos[nr];
				let aspectRatio = null;
				for (let i = 0; i < 2; i++) {
					let dx = cp[i].vx * dt;
					let dy = cp[i].vy * dt;
					cp[i].x += dx;
					cp[i].y += dy;
					cp[i].vx *= .5;
					cp[i].vy *= .5;
				}
				let videoBox = mapNrVideoBox[nr];
				videoBox.resize(cp[0].x, cp[0].y, cp[1].x - cp[0].x, cp[1].y - cp[0].y);
			}
			console.log("autoResize2: numStep=%s, w=%s, h=%s, currentPos=%s", numStep, vpWidth, vpHeight, JSON.stringify(currentPos));
			numStep++;
			if (numStep < maxStep) {
				setTimeout(doPhysics, millisWait);
			}
		};
		doPhysics();
	}

	/**
	 * Resizes all video-boxes
	 * @param width-factor
	 */
	this.resizeVideoBoxes = function (widthFactor) {
		var viewportWidth = window.innerWidth;
		var widthNew = (viewportWidth * widthFactor) + "px";
		console.log("resizeVideoBoxes: viewport=%s, factor=%s, newsize=%s",
				viewportWidth, widthFactor, widthNew);
		$$('video').forEach((el) => el.style.width = widthNew);
	}
		
	/**
	 * Gives all video-boxes an absolute position.
	 */
	this.switchToAbsoluteLayout = function () {
		if (!this.isAbsoluteLayout) {
			console.log('switchToAbsoluteLayout');
			let newPositions = {};
			for (let nr in mapNrVideoBox) {
				let videoBox = mapNrVideoBox[nr];
				let viewportWidth = window.innerWidth;
				let rectVideo = videoBox.elVideo.getBoundingClientRect();
				let vx = rectVideo.x + window.scrollX;
				let vy = rectVideo.y + window.scrollY;
				newPositions[nr] = {x: (vx + "px"), y: (vy + "px")};
			}
			for (let nr in mapNrVideoBox) {
				let videoBox = mapNrVideoBox[nr];
				videoBox.elFigure.style.position = "absolute";
				videoBox.elFigure.style.left = newPositions[nr].x;
				videoBox.elFigure.style.top = newPositions[nr].y;
			}
			
			this.isAbsoluteLayout = true;
		}
	}

	/**
	 * Checks the layout of a video-box.
	 * This is important for new video-boxes in an absolute layout.
	 * @param videoBox VideoBox
	 */
	this.checkVideoBoxLayout = function (videoBox) {
		if (this.isAbsoluteLayout) {
			let viewportWidth = window.innerWidth;
			let rectVideo = videoBox.elVideo.getBoundingClientRect();
			let vx = rectVideo.x + window.scrollX;
			let vy = rectVideo.y + window.scrollY;
			videoBox.elFigure.style.position = "absolute";
			videoBox.elFigure.style.left = (vx + "px");
			videoBox.elFigure.style.top = (vy + "px");
		}
	}

	/**
	 * Removes the visibility of the buttons.
	 */
	this.removeButtonVisibility = function () {
		console.log('removeButtonVisibility');
		$$('figure').forEach((el) => el.classList.add('figure-hidden'));
		$$('.controls').forEach((el) => el.classList.add('controls-hidden'));
	}

	/**
	 * Toggles the visibility of the buttons.
	 */
	this.toggleButtonVisibility = function () {
		console.log('toggleButtonVisibility');
		$$('figure').forEach((el) => el.classList.toggle('figure-hidden'));
		$$('.controls').forEach((el) => el.classList.toggle('controls-hidden'));
	}
}

/**
 * Change constraints for all local video streams.
 * @param newWidth new width
 * @param newHeight new height
 */
function changeConstraints(newWidth, newHeight) {
	for (let nr in mapNrVideoBox) {
		let videoBox = mapNrVideoBox[nr];
		let boxType = videoBox.boxType;
		let stream = videoBox.videoLocal;
		if (stream && boxType == BOX_TYPE_VIDEO) {
			const track = stream.getVideoTracks()[0];
		  
			console.log('Track: id=%s, isEnabled=%s, kind=%s, label=%s, readyState=%s',
				track.id, track.enabled, track.kind, track.label, track.readyState);
			let settings = track.getSettings();
			console.log('  Settings: deviceId=%s, groupId=%s, w=%d, h=%d, fr=%f',
				settings.deviceId, settings.groupId, settings.width, settings.height, settings.frameRate);
		
			let constraints = { width: newWidth, height: newHeight };
			track.applyConstraints(constraints)
			.then(() => {
				message.textContent = `Constraints wurden aktualisiert: ${newWidth} × ${newHeight}.`;
			})
			.catch(e => {
				message.textContent = "Error while applying the constraints (${newWidth} × ${newHeight}): " + e;
				throw e;
			});
		}
	}
}

/**
 * Searches the first local video-box.
 * @returns video-box or null
 */
function searchVideoBoxLocal() {
	let videoBoxLocal = null;
	for (let nr in mapNrVideoBox) {
		let videoBox = mapNrVideoBox[nr];
		let videoBoxUser = videoBox.elUser.value;
		if (videoBox.isLocalStream && videoBox.elUser.value.trim() != "") {
			videoBoxLocal = videoBox;
			break;
		} 
	}
	return videoBoxLocal;
}

function searchVideoBoxByName(name) {
	let videoBoxLocal = null;
	for (let nr in mapNrVideoBox) {
		let videoBox = mapNrVideoBox[nr];
		let videoBoxUser = videoBox.elUser.value;
		if (simplifyName(name) == simplifyName(videoBoxUser)) {
			videoBoxLocal = videoBox;
			break;
		} 
	}
	return videoBoxLocal;
}

function searchVideoBoxByType(boxType) {
	let videoBoxLocal = null;
	for (let nr in mapNrVideoBox) {
		let videoBox = mapNrVideoBox[nr];
		if (videoBox.boxType == boxType) {
			videoBoxLocal = videoBox;
			break;
		} 
	}
	return videoBoxLocal;
}

/**
 * Removes trailing whitespace and some quotation-marks.
 * @param name name
 * @returns simplified lower-case name
 */
function cleanName(name) {
	return (name != null) ? name.replace(/[\'\"„“]/g,'').trim() : null;
}

/**
 * Removes some whitespace and some punctuation. 
 * This function is used to compare names.
 * @param name name
 * @returns simplified lower-case name
 */
function simplifyName(name) {
	if (name == null) {
		console.error("simplifyName: invalid null-name");
	}
	return (name != null) ? cleanName(name).toLowerCase().replace(/[ ,.'-]/g,'') : null;
}

function showStatistics(isVerbose) {
	var elDiv = $('#statistics');
	elDiv.innerHTML = "<h2 data-i18n=\"WebRTC-Statistik\">" + $.i18n("WebRTC-Statistik") + "</h2>";
	var statsOutput = "";
	for (let peerKey in rtcConnections) {
		let videoBoxRtcConn = rtcConnections[peerKey];
		let videoBox = videoBoxRtcConn.videoBox;
		let localName = videoBox.localName;
		let peerNr = videoBox.peerNr;
		let peerName = videoBox.peerName;
		var htmlPeer = `<h3>Videobox („${localName}“ -> „${peerName}“/${peerNr})</h3>`;
		videoBoxRtcConn.rtcConnection.getStats(null).then(stats => {
			htmlPeer += "<ul>";
			stats.forEach(report => {
				Object.keys(report).forEach(statName => {
					if (isVerbose
						|| (statName == 'bytesReceived' || statName == 'bytesSent' || statName == 'bitrateMean'))
					htmlPeer += `<li>${report.type}, ${report.kind}, ${statName}: ${report[statName]}</li>`; 
				});
			});
			htmlPeer += "</ul>";
			elDiv.innerHTML += htmlPeer;
		});
	}
}

function startVideoLocal(boxType, name, nr) {
	console.log('startVideoLocal: boxType=%s, nr=%s', boxType, nr);
	var videoBox = mapNrVideoBox[nr];
	if (!videoBox) {
		throw `Die Videobox für den lokalen Stream ${nr} wurde nicht gefunden.`;
	}
	videoBox.localName = name;
	videoBox.isActive = true;
	if (boxType != BOX_TYPE_REQUEST) {
		delete videoBox.messages[MSG_KEY_BOX_TYPE];
		videoBox.showVideoBoxMessages(false);
	}

	let videoConstraints = { audio: true, video: true };
	let gdmOptions = { video: { cursor: "always" }, audio: false };
	let mediaFuture;
	if (boxType == BOX_TYPE_VIDEO) {
		mediaFuture = navigator.mediaDevices.getUserMedia(videoConstraints)
	}
	else if (boxType == BOX_TYPE_SCREEN) {
		mediaFuture = navigator.mediaDevices.getDisplayMedia(gdmOptions);
	}
	else if (boxType == BOX_TYPE_CHAT) {
		console.log(`startVideoLocal: nr=${nr}, text-chat only`);
		return;
	}
	else if (boxType == BOX_TYPE_REQUEST) {
		console.log(`startVideoLocal: nr=${nr}, request only, no local video`);
		return;
	}
	else {
		throw "Unknown boxType: " + boxType;
		return;
	}
	var elVideo = videoBox.elVideo;
	mediaFuture.then(function(stream) {
		videoBox.videoLocal = stream;
		let tracks = stream.getVideoTracks();
		if (tracks && tracks.length > 0) {
			let track = tracks[0];
			let settings = track.getSettings();
			console.log("localStream: id=%s, isActive=%s, w=%s, h=%s",
					stream.id, stream.active,
					settings.aspectRatio, settings.width, settings.height);
		}
		else {
			console.log("localStream: id=%s, isActive=%s", stream.id, stream.active);
		}
		if (!("srcObject" in elVideo)) {
			throw "Das video-Element des Browsers kennt noch kein srcObject-Attribut.";
		}
		elVideo.srcObject = stream;
		elVideo.addEventListener('loadedmetadata', (event) => {
			console.log('event metadata: %s', event);
			elVideo.play();
		});
		// Check if the video accidentially has been stopped.
		var tsStart = new Date();
		elVideo.addEventListener('pause', (event) => {
			let tsNow = new Date();
			console.log("localStream: event pause, boxNr=%s, tsStart=%s, tsNow=%s",
					nr, tsStart, tsNow);
			if (tsNow - tsStart < 5000) {
				elVideo.play();
			}
		});
	})
	.catch(function (err) {
		console.warn("userMedia-Error: %s - %s", err.name, err.message);
		console.log("userMedia-Details: %o", err);
		messages.showMessage($.i18n("Lokales Video steht nicht zur Verfügung: $1 / $2", err.name, err.message));
	});
}

/**
 * Adds a local stream to a RTC.
 * @param videoBox video-box containing local stream
 * @param rtcConnection RTC
 */
function addVideoLocal(videoBox, rtcConnection) {
	console.log('addVideoLocal: boxNr=%s, boxName=%s',
			videoBox.nr, videoBox.elUser.value);
	let stream = videoBox.videoLocal;
	if (!stream) {
		console.log(`addVideoLocal: boxNr=%s, kein videoLocal-stream`, videoBox.nr);
		return;
	}
	for (const track of stream.getTracks()) {
		if (track.kind == "video") {
			let settings = track.getSettings();
			console.log("addTrack/localVideo: %s - %s - %",
					track.kind, track.label, track.id);
		}
		else {
			console.log("addTrack/localStream: %s - %s - %s", track.kind, track.label, track.id);
		}

		rtcConnection.addTrack(track, stream);
	}
}

function stopAllStreams() {
	console.log("stopAllStreams");
	for (let nr in mapNrVideoBox) {
		let videoBox = mapNrVideoBox[nr];
		if (videoBox.isLocalStream) {
			videoBox.refreshVideoBoxBoolean(true, 'hangup', "Aufgelegt");
			stopVideoLocal(videoBox);
		}
	}
	for (let peerName in mapPeerNameVideoBox) {
		stopVideoRemote(peerName);
	}
	wsManager.close();
}

function stopVideoLocal(videoBox) {
    console.log("stopVideoLocal: boxNr=%s", videoBox.nr);

    videoBox.isActive = false;
    let elVideo = videoBox.elVideo;
    if (elVideo) {
	    const stream = elVideo.srcObject;
	    if (!stream) {
	    	console.log("Am lokalen Video-Element steht kein Stream mehr zur Verfügung.");
	    }
	    else {
	        stream.getTracks().forEach(function(track) {
	        track.stop();
	        });
	    }
	    elVideo.removeAttribute("src");
	    elVideo.removeAttribute("srcObject");
    }
}

function stopVideoRemote(peerName) {
	let videoBox = mapPeerNameVideoBox[peerName];
	if (videoBox) {
		videoBox.isActive = false;
		let localName = videoBox.localName;
		let peerNr = videoBox.peerNr;
		let peerKey = peerName + '.' + peerNr;
		var videoBoxRtcConnection = rtcConnections[peerKey];
		var elVideo = videoBox.elVideo;
		var elHangupBtn = videoBox.elHangupBtn;
		console.log("stopVideoRemote: localName=%s, peerName=%s, peerNr=%s, elVideo=%s, elHangupBtn=%s",
				localName, peerName, peerNr, elVideo, elHangupBtn);
		closeVideoCall(peerName, peerNr, videoBoxRtcConnection, elVideo, elHangupBtn);
		wsManager.send({
			type: "leave",
			name: localName,
			peer: peerName,
			session: $('#sessionId').value
		});
	}
}

document.addEventListener('DOMContentLoaded', initPage);
