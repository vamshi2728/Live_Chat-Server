const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "https://vamshi2728.github.io",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

/*
    Each mode has its own waiting queue.

    Example:
    video: [socketId]
    voice: [socketId]
    text:  [socketId]
*/
const waitingUsers = {
    video: [],
    voice: [],
    text: []
};

const users = new Map();

/*
    users:
    socketId -> {
        mode,
        room
    }
*/

function removeFromQueue(socketId) {
    for (const mode of Object.keys(waitingUsers)) {
        waitingUsers[mode] = waitingUsers[mode].filter(
            (id) => id !== socketId
        );
    }
}

function leaveCurrentRoom(socketId, tellOtherUser = true) {
    const user = users.get(socketId);

    if (!user || !user.room) {
        return;
    }

    const room = user.room;

    const socketsInRoom = io.sockets.adapter.rooms.get(room);

    if (socketsInRoom) {
        for (const otherId of socketsInRoom) {
            if (otherId !== socketId) {
                const otherUser = users.get(otherId);

                if (otherUser) {
                    otherUser.room = null;

                    if (tellOtherUser) {
                        io.to(otherId).emit("stranger-left");
                    }
                }
            }
        }
    }

    const socket = io.sockets.sockets.get(socketId);

    if (socket) {
        socket.leave(room);
    }

    user.room = null;
}

io.on("connection", (socket) => {
    users.set(socket.id, {
        mode: null,
        room: null
    });

    socket.on("find-stranger", ({ mode }) => {
        if (!["video", "voice", "text"].includes(mode)) {
            return;
        }

        const user = users.get(socket.id);

        if (!user) {
            return;
        }

        removeFromQueue(socket.id);
        leaveCurrentRoom(socket.id, false);

        user.mode = mode;

        const queue = waitingUsers[mode];

        /*
            Find another waiting socket.
        */
        let strangerId = null;

        while (queue.length > 0) {
            const candidate = queue.shift();

            if (candidate !== socket.id && users.has(candidate)) {
                const candidateUser = users.get(candidate);

                if (candidateUser && !candidateUser.room) {
                    strangerId = candidate;
                    break;
                }
            }
        }

        if (!strangerId) {
            queue.push(socket.id);

            socket.emit("waiting");
            return;
        }

        const room = `room-${socket.id}-${strangerId}`;

        const strangerSocket = io.sockets.sockets.get(strangerId);

        if (!strangerSocket) {
            queue.push(socket.id);
            socket.emit("waiting");
            return;
        }

        user.room = room;

        const strangerUser = users.get(strangerId);

        strangerUser.room = room;

        socket.join(room);
        strangerSocket.join(room);

        /*
            One person becomes the WebRTC offer creator.
        */
        socket.emit("matched", {
            room,
            initiator: true
        });

        strangerSocket.emit("matched", {
            room,
            initiator: false
        });
    });

    /*
        WebRTC signaling.
        The server does not inspect the audio/video.
        It only passes signaling data between the two users.
    */
    socket.on("signal", ({ room, data }) => {
        if (!room || !data) {
            return;
        }

        socket.to(room).emit("signal", data);
    });

    /*
        Text messages.
    */
    socket.on("chat-message", ({ room, message }) => {
        if (!room || typeof message !== "string") {
            return;
        }

        const cleanMessage = message.trim().slice(0, 500);

        if (!cleanMessage) {
            return;
        }

        socket.to(room).emit("chat-message", cleanMessage);
    });

    socket.on("leave-room", () => {
        removeFromQueue(socket.id);
        leaveCurrentRoom(socket.id, true);
    });

    socket.on("disconnect", () => {
        removeFromQueue(socket.id);
        leaveCurrentRoom(socket.id, true);
        users.delete(socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Live_Chat is running at http://localhost:${PORT}`);
});
