# StreamMediator

## Project description

Multiple "peer to peer" video-communication based on a modern browsers [WebRTC](https://en.wikipedia.org/wiki/WebRTC)-support. This web application contains a Java-backend and JavaScript-frontend. The server and additional [STUN](https://en.wikipedia.org/wiki/STUN)-servers are needed for the initial handshake between the peers of the video-streams only.

* video-/audio-chats
* video-boxes can be resized and dragged around.
* screen- or window-sharing
* language switching (german and english)
* simple text-chat-window
* auto-layout

### Example

There is a server demonstrating the StreamMediator at [www.ab32.de](https://www.ab32.de/wrs).

## Motivation

I wanted an open-source video-communication solution. When I tried to download a well-known open-source implementation of a video-communication-system in march 2020 I was struck by a lot of different large components. For example [jitsi](https://download.jitsi.org/stable/) and [Nextcloud talk](https://download.nextcloud.com/server/releases/) are full-fledged solutions containing a lot of nice features. I was struck by the complexity only.

So I started to write a multi-stream-WebRTC solution from scratch based on one single JavaScript-file on the client side. The initial requirements were:

* Simple WebRTC-session between two peers.
* Buttons for dragging and resizing video-boxes.
* Privacy: The participants of a session are not displayed. Hence you won't see a "room" when entering a session-id already used. 
* WebRTC-sessions between multiple peers.

The current script is about 70 kb in size containing about 2150 lines of code (non-minified). The server side consists of about 1250 lines of code (Java).

The clients need to be able to communicate directly, there is no TURN-server, there are two STUN-servers only. Therefore proxies, some firewalls or routers of some providers can be a spoiler.

## Building

You may use maven for building the project.
``` shell
  mvn package
```

## Installation

The StreamMediator expects a web application server containing [jetty's](https://www.eclipse.org/jetty/) websocket-support.

## Usage

Assume there are three users A, B and C.

1. A connects to the server, gets the session `a12b3c` and connects to the server as user `A`.
2. A tells B and C about the session `a12b3c` via messenger or phone.
3. B connects to the server, overrides the given session with `a12b3c` and connects to the server as user `B`.
4. B calls user `A`, user A confirms and a video-communication between A and B will be established.
5. C connects to the server, overrides the given session with `a12b3c` and connects to the server as user `C`.
6. C calls user `A`, user A confirms and a video-communication between A and C will be established.
7. C calls user `B`, user B confirms and a video-communication between B and C will be established.
