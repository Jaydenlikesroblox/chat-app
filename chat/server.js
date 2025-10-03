const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const connectedUsers = new Map(); // Map userId to socket.id

// --- DATABASE ---
const DB_PATH = path.join(__dirname, 'db.json');
let db = { users: {}, conversations: {}, friends: {}, pendingRequests: {} };

function readDb() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const data = fs.readFileSync(DB_PATH, 'utf8');
            db = JSON.parse(data);
        } else {
            writeDb();
        }
    } catch (e) {
        console.error("Failed to read or parse db.json", e);
    }
}

function writeDb() {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

readDb();

// --- MIDDLEWARE & STATIC FILES ---
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- FILE UPLOADS (AVATARS) ---
const storage = multer.diskStorage({
    destination: './chat/uploads/',
    filename: function (req, file, cb) {
        cb(null, `avatar-${req.user.id}-${uuidv4()}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 1024 * 1024 }, // 1MB limit
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb("Error: File upload only supports the following filetypes - " + filetypes);
    }
});



const uploadChatFile = multer({
    storage: chatFileStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif|mp4|webm|ogg/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb("Error: File upload only supports the following filetypes - " + filetypes);
    }
});



// --- AUTHENTICATION API ---
// This is a mock auth middleware. In a real app, use JWTs.
const authMiddleware = (req, res, next) => {
    const userId = req.headers['x-user-id'];
    if (userId && db.users[userId]) {
        req.user = { id: userId, ...db.users[userId] };
        next();
    } else {
        res.status(401).json({ message: "Unauthorized" });
    }
};

app.post('/api/register', (req, res) => {
    console.log('[/api/register] received request with body:', req.body);
    const { email, password } = req.body;
    if (!email || !password || password.length < 6) {
        return res.status(400).json({ message: "Invalid email or password (must be 6+ chars)." });
    }
    const emailLower = email.toLowerCase();
    const isTaken = Object.values(db.users).some(u => u && u.email && u.email.toLowerCase() === emailLower);
    if (isTaken) {
        return res.status(400).json({ message: "Email is already registered." });
    }
    const userId = `user_${uuidv4()}`;
    db.users[userId] = { 
        id: userId,
        email, 
        password, // In a real app, HASH THIS PASSWORD!
        username: '', 
        username_lower: '',
        avatarUrl: `https://placehold.co/40x40/4f46e5/ffffff?text=${email.charAt(0).toUpperCase()}`
    };
    writeDb();
    res.status(201).json({ id: userId, ...db.users[userId] });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const userEntry = Object.entries(db.users).find(([id, u]) => u.email === email && u.password === password);
    if (userEntry) {
        const [userId, userData] = userEntry;
        res.status(200).json({ id: userId, ...userData });
    } else {
        res.status(401).json({ message: "Invalid credentials." });
    }
});

app.post('/api/profile', authMiddleware, upload.single('avatar'), (req, res) => {
    const { username } = req.body;
    const userId = req.user.id;
    const updates = {};

    // 1. Username validation
    if (username) {
        if (username.length < 3 || username.length > 15 || !/^[a-zA-Z0-9_-]+$/.test(username)) {
            return res.status(400).json({ message: "Username must be 3-15 chars (alphanumeric, hyphen, underscore)." });
        }
        const usernameLower = username.toLowerCase();
        if (usernameLower !== db.users[userId].username_lower) {
            const isTaken = Object.values(db.users).some(u => u.username_lower === usernameLower);
            if (isTaken) {
                return res.status(400).json({ message: "This username is already taken." });
            }
            updates.username = username;
            updates.username_lower = usernameLower;
        }
    }

    // 2. Avatar update
    if (req.file) {
        updates.avatarUrl = `/uploads/${req.file.filename}`;
    }

    // 3. Apply updates
    if (Object.keys(updates).length > 0) {
        db.users[userId] = { ...db.users[userId], ...updates };
        writeDb();
    }

    res.status(200).json({ message: "Profile updated successfully", user: db.users[userId] });
});

app.post('/api/upload', authMiddleware, uploadChatFile.single('chat-file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: "No file uploaded." });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    res.status(200).json({ fileUrl });
});




// --- SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
    let currentUserId = null;

    socket.on('authenticate', (userId) => {
        if (userId && db.users[userId]) {
            currentUserId = userId;
            connectedUsers.set(currentUserId, socket.id); // Add user to map
            socket.join(currentUserId); // User joins a room for their own ID for direct notifications
            console.log(`User authenticated: ${db.users[currentUserId].email} (${currentUserId})`);
            socket.emit('auth-success', db.users[currentUserId]);

            // 1. Notify friends that this user is online
            const friendsOfCurrentUser = Object.keys(db.friends[currentUserId] || {});
            friendsOfCurrentUser.forEach(friendId => {
                if (connectedUsers.has(friendId)) {
                    io.to(friendId).emit('online-status', { userId: currentUserId, isOnline: true });
                }
            });

            // 2. Send this user the online status of their friends
            const friendStatuses = friendsOfCurrentUser.map(friendId => ({
                userId: friendId,
                isOnline: connectedUsers.has(friendId)
            }));
            socket.emit('friends-online-status', friendStatuses);
        }
    });

    socket.on('get-initial-data', () => {
        if (!currentUserId) return;
        const userFriends = db.friends[currentUserId] || {};
        const friendDetails = Object.keys(userFriends).map(id => ({ id, ...db.users[id], conversationId: userFriends[id] }));
        socket.emit('friends-list', friendDetails);

        const userRequests = db.pendingRequests[currentUserId] || {};
        const requestDetails = Object.keys(userRequests).map(id => ({ id, ...db.users[id] }));
        socket.emit('requests-list', requestDetails);
    });

    socket.on('send-friend-request', async (targetUsername) => {
        if (!currentUserId || !targetUsername) return;
        const targetUserEntry = Object.entries(db.users).find(([id, u]) => u.username_lower === targetUsername.toLowerCase());
        if (!targetUserEntry) {
            return socket.emit('status-error', `User @${targetUsername} not found.`);
        }
        const targetId = targetUserEntry[0];
        if (targetId === currentUserId) {
            return socket.emit('status-error', 'You cannot add yourself.');
        }

        if (!db.pendingRequests[targetId]) db.pendingRequests[targetId] = {};
        db.pendingRequests[targetId][currentUserId] = true;
        writeDb();

        // Notify target user if they are online
        const sender = db.users[currentUserId];
        io.to(targetId).emit('new-request', { id: currentUserId, username: sender.username, avatarUrl: sender.avatarUrl });

        socket.emit('status-success', `Request sent to @${targetUsername}.`);
    });

    socket.on('accept-friend-request', (senderId) => {
        if (!currentUserId || !db.pendingRequests[currentUserId] || !db.pendingRequests[currentUserId][senderId]) return;

        const conversationId = [currentUserId, senderId].sort().join('_');
        
        if (!db.friends[currentUserId]) db.friends[currentUserId] = {};
        db.friends[currentUserId][senderId] = conversationId;

        if (!db.friends[senderId]) db.friends[senderId] = {};
        db.friends[senderId][currentUserId] = conversationId;

        if (!db.conversations[conversationId]) db.conversations[conversationId] = [];

        delete db.pendingRequests[currentUserId][senderId];
        writeDb();

        // Notify both users to update their lists
        io.to(currentUserId).emit('reload-data');
        io.to(senderId).emit('reload-data');
    });

    socket.on('get-messages', (conversationId) => {
        if (!currentUserId || !db.conversations[conversationId]) return;
        socket.join(conversationId);
        socket.emit('messages-history', { conversationId, messages: db.conversations[conversationId] });
    });

    socket.on('send-message', ({ conversationId, text, fileUrl }) => {
        if (!currentUserId || !db.conversations[conversationId]) return;
        const message = { 
            id: uuidv4(),
            userId: currentUserId, 
            text, 
            fileUrl,
            timestamp: new Date().toISOString() 
        };
        db.conversations[conversationId].push(message);
        writeDb();
        io.to(conversationId).emit('new-message', { conversationId, message });
    });

    socket.on('typing-start', ({ conversationId, userId }) => {
        socket.to(conversationId).emit('typing-status', { conversationId, userId, isTyping: true });
    });

    socket.on('typing-stop', ({ conversationId, userId }) => {
        socket.to(conversationId).emit('typing-status', { conversationId, userId, isTyping: false });
    });

    socket.on('messages-read', ({ conversationId, readerId }) => {
        if (!db.conversations[conversationId]) return;

        db.conversations[conversationId].forEach(message => {
            if (message.userId !== readerId) {
                if (!message.readBy) {
                    message.readBy = [];
                }
                if (!message.readBy.includes(readerId)) {
                    message.readBy.push(readerId);
                }
            }
        });
        writeDb();

        const participants = conversationId.split('_');
        const senderId = participants.find(id => id !== readerId);

        if (senderId && connectedUsers.has(senderId)) {
            console.log(`Emitting 'message-read' event to sender ${senderId} for conversation ${conversationId}`);
            io.to(senderId).emit('message-read', { conversationId, readerId });
        }
    });

    socket.on('unfriend', async ({ friendId }) => {
        if (!currentUserId) return;

        try {
            // Remove from friends list for both users
            if (db.friends[currentUserId] && db.friends[currentUserId][friendId]) {
                delete db.friends[currentUserId][friendId];
            }
            if (db.friends[friendId] && db.friends[friendId][currentUserId]) {
                delete db.friends[friendId][currentUserId];
            }

            // Remove conversation
            const conversationId = [currentUserId, friendId].sort().join('_');
            if (db.conversations[conversationId]) {
                delete db.conversations[conversationId];
            }

            writeDb();

            // Notify both users
            io.to(currentUserId).emit('unfriended', { friendId });
            io.to(friendId).emit('unfriended', { friendId: currentUserId });
            io.to(currentUserId).emit('reload-data'); // To update friend list
            io.to(friendId).emit('reload-data'); // To update friend list

            console.log(`User ${currentUserId} unfriended ${friendId}`);
        } catch (error) {
            console.error('Error unfriending user:', error);
            socket.emit('unfriendError', { message: 'Failed to unfriend user.' });
        }
    });

    // --- CALL SYSTEM SOCKET.IO EVENTS ---
    socket.on('call-request', ({ targetUserId, callType }) => {
        if (!currentUserId || !targetUserId) return;
        console.log(`Call request from ${currentUserId} to ${targetUserId} (${callType})`);
        // Notify target user if they are online
        io.to(targetUserId).emit('incoming-call', {
            callerId: currentUserId,
            callerUsername: db.users[currentUserId].username,
            callType
        });
    });

    socket.on('call-response', ({ targetUserId, accepted, callType }) => {
        if (!currentUserId || !targetUserId) return;
        console.log(`Call response from ${currentUserId} to ${targetUserId}: ${accepted ? 'Accepted' : 'Declined'}`);
        io.to(targetUserId).emit('call-response', {
            responderId: currentUserId,
            accepted,
            callType
        });
    });

    socket.on('webrtc-offer', ({ targetUserId, offer }) => {
        if (!currentUserId || !targetUserId) return;
        console.log(`WebRTC Offer from ${currentUserId} to ${targetUserId}`);
        io.to(targetUserId).emit('webrtc-offer', { senderId: currentUserId, offer });
    });

    socket.on('webrtc-answer', ({ targetUserId, answer }) => {
        if (!currentUserId || !targetUserId) return;
        console.log(`WebRTC Answer from ${currentUserId} to ${targetUserId}`);
        io.to(targetUserId).emit('webrtc-answer', { senderId: currentUserId, answer });
    });

    socket.on('webrtc-ice-candidate', ({ targetUserId, candidate }) => {
        if (!currentUserId || !targetUserId) return;
        console.log(`WebRTC ICE Candidate from ${currentUserId} to ${targetUserId}`);
        io.to(targetUserId).emit('webrtc-ice-candidate', { senderId: currentUserId, candidate });
    });

    socket.on('call-end', ({ targetUserId }) => {
        if (!currentUserId || !targetUserId) return;
        console.log(`Call ended between ${currentUserId} and ${targetUserId}`);
        io.to(targetUserId).emit('call-ended', { endedBy: currentUserId });
    });

    socket.on('disconnect', () => {
        console.log('user disconnected', socket.id);
        if (currentUserId) {
            connectedUsers.delete(currentUserId); // Remove user from map

            // Notify friends that this user is offline
            const friendsOfCurrentUser = Object.keys(db.friends[currentUserId] || {});
            friendsOfCurrentUser.forEach(friendId => {
                if (connectedUsers.has(friendId)) { // Only notify online friends
                    io.to(friendId).emit('online-status', { userId: currentUserId, isOnline: false });
                }
            });
        }
    });
});

app.use((req, res) => {
    console.log(`[Catch-all] ${req.method} ${req.path}`);
    res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});