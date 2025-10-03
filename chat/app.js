const socket = io();

const PLACEHOLDER_AVATAR = "https://placehold.co/40x40/4f46e5/ffffff?text=U";
const MAX_FILE_SIZE = 1024 * 1024; // 1MB limit for PFP

let typingTimeout = {}; // To store timeouts for each conversation

// --- STATE MANAGEMENT ---
let state = {
    userId: localStorage.getItem('userId') || null,
    token: localStorage.getItem('token') || null, // In a real app, this would be a JWT
    user: JSON.parse(localStorage.getItem('user')) || null,
    activeFriendId: null,
    activeConversationId: null,
    selectedFile: null,
    selectedMessageFile: null,

    // Call related state
    localStream: null,
    remoteStream: null,
    peerConnection: null,
    isCalling: false,
    isReceivingCall: false,
    currentCallType: null, // 'audio' or 'video'
    currentCallerId: null,
    currentCallerUsername: null,

    // Background customization state
    chatBackgroundColor: localStorage.getItem('chatBackgroundColor') || null,
};

const ELEMENTS = {
    appContainer: document.getElementById('app-container'),
    authModal: document.getElementById('auth-modal'),
    authEmail: document.getElementById('auth-email'),
    authPassword: document.getElementById('auth-password'),
    authStatus: document.getElementById('auth-status'),
    userInfo: document.getElementById('user-info'),
    friendIdInput: document.getElementById('friend-id-input'),
    searchStatus: document.getElementById('search-status'),
    friendsList: document.getElementById('friends-list'),
    requestsList: document.getElementById('requests-list'),
    requestCount: document.getElementById('request-count'),
    noFriends: document.getElementById('no-friends'),
    noRequests: document.getElementById('no-requests'),
    chatHeader: document.getElementById('current-chat-name'),
    chatWindow: document.getElementById('chat-window'),
    chatPlaceholder: document.getElementById('chat-placeholder'),
    messageForm: document.getElementById('message-form'),
    messageInput: document.getElementById('message-input'),
    sendButton: document.getElementById('send-button'),
    modal: document.getElementById('message-modal'),
    modalTitle: document.getElementById('modal-title'),
    modalContent: document.getElementById('modal-content'),
    darkModeToggle: document.getElementById('dark-mode-toggle'),
    usernameInput: document.getElementById('username-input'),
    usernameStatus: document.getElementById('username-status'),
    saveProfileButton: document.getElementById('save-profile-button'),
    pfpUploadInput: document.getElementById('pfp-upload-input'),
    pfpPreview: document.getElementById('pfp-preview'),
    pfpLabel: document.getElementById('pfp-label'),
    sidebar: document.getElementById('sidebar'),
    chatPanel: document.getElementById('chat-panel'),
    backButton: document.getElementById('back-button'),
    settingsButton: document.getElementById('settings-button'),
    settingsMenu: document.getElementById('settings-menu'),
    signInButton: document.getElementById('signInButton'),
    signUpButton: document.getElementById('signUpButton'),
    fileInput: document.getElementById('file-input'),
    attachFileButton: document.getElementById('attach-file-button'),
    filePreviewContainer: document.getElementById('file-preview-container'),
    filePreviewImage: document.getElementById('file-preview-image'),
    cancelFileButton: document.getElementById('cancel-file-button'),

    // Call related elements
    videoCallButton: document.getElementById('video-call-button'),
    voiceCallButton: document.getElementById('voice-call-button'),
    incomingCallModal: document.getElementById('incoming-call-modal'),
    incomingCallerUsername: document.getElementById('incoming-caller-username'),
    incomingCallType: document.getElementById('incoming-call-type'),
    acceptCallButton: document.getElementById('accept-call-button'),
    declineCallButton: document.getElementById('decline-call-button'),
    activeCallOverlay: document.getElementById('active-call-overlay'),
    localVideo: document.getElementById('local-video'),
    remoteVideo: document.getElementById('remote-video'),
    toggleAudioButton: document.getElementById('toggle-audio-button'),
    toggleVideoButton: document.getElementById('toggle-video-button'),
    endCallButton: document.getElementById('end-call-button'),

    // Background customization elements
    backgroundColorPicker: document.getElementById('background-color-picker'),
    resetBackgroundButton: document.getElementById('reset-background-button'),
};

// --- UTILITY & RENDER FUNCTIONS ---

function showModal(title, content) {
    ELEMENTS.modalTitle.textContent = title;
    ELEMENTS.modalContent.textContent = content;
    ELEMENTS.modal.classList.remove('hidden');
}
window.closeModal = () => ELEMENTS.modal.classList.add('hidden');

function getConversationId(id1, id2) {
    return [id1, id2].sort().join('_');
}

function toggleMobileView(showChat) {
    if (window.innerWidth >= 768) {
        ELEMENTS.sidebar.classList.remove('hidden');
        ELEMENTS.chatPanel.classList.remove('hidden');
        ELEMENTS.backButton.style.display = 'none';
        return;
    }
    if (showChat) {
        ELEMENTS.sidebar.classList.add('hidden');
        ELEMENTS.chatPanel.classList.remove('hidden');
        ELEMENTS.backButton.style.display = 'block';
    } else {
        ELEMENTS.chatPanel.classList.add('hidden');
        ELEMENTS.sidebar.classList.remove('hidden');
        ELEMENTS.backButton.style.display = 'none';
        ELEMENTS.chatHeader.textContent = "Select a friend to start chatting";
        ELEMENTS.videoCallButton.classList.add('hidden'); // Hide call buttons when no friend is selected
        ELEMENTS.voiceCallButton.classList.add('hidden'); // Hide call buttons when no friend is selected
    }
}
window.handleBackToFriends = () => toggleMobileView(false);

// Check for user's system preference on page load
const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)");

// Check for saved theme in local storage or system preference
const currentTheme = localStorage.getItem("theme") || (prefersDarkScheme.matches ? "dark" : "light");

// Apply initial theme
document.documentElement.className = currentTheme;

// Get the toggle button
const themeToggle = document.querySelector("[data-theme-toggle]");

// Update button text on load
updateButtonText();

// Listen for clicks on the toggle button
themeToggle.addEventListener("click", () => {
  let theme = document.documentElement.className;
  if (theme === "dark") {
    theme = "light";
  } else {
    theme = "dark";
  }
  document.documentElement.className = theme;
  localStorage.setItem("theme", theme);
  updateButtonText();
});

function updateButtonText() {
  const currentTheme = document.documentElement.className;
  if (currentTheme === "dark") {
    themeToggle.textContent = "Change to light theme";
  } else {
    themeToggle.textContent = "Change to dark theme";
  }
}

function updateUserInfoUI() {
    if (!state.user) return;
    const { id, username, avatarUrl } = state.user;
    ELEMENTS.pfpPreview.src = avatarUrl || PLACEHOLDER_AVATAR;
    ELEMENTS.usernameInput.value = username || '';
    ELEMENTS.userInfo.innerHTML = `
        Your User ID: <span class="font-mono text-gray-700 dark:text-gray-300">${id}</span>
        <br>
        Username: <span class="font-bold text-indigo-600 dark:text-indigo-400">${username ? '@' + username : 'PENDING'}</span>
    `;
}

// --- API & SOCKET FUNCTIONS ---

async function apiRequest(endpoint, method, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.userId) {
        headers['x-user-id'] = state.userId; // Mock authentication header
    }
    const response = await fetch(endpoint, { method, headers, body: JSON.stringify(body) });
    if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.indexOf('application/json') !== -1) {
            const error = await response.json();
            throw new Error(error.message);
        } else {
            const errorText = await response.text();
            console.error("Server returned non-JSON error:", errorText);
            throw new Error("An unexpected error occurred. The server returned a non-JSON response.");
        }
    }
    return response.json();
}

// --- WEBRTC CALLING FUNCTIONS ---
async function getMedia(video = true, audio = true) {
    try {
        console.log(`getMedia called with: video=${video}, audio=${audio}`);
        const constraints = { video, audio };
        state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        ELEMENTS.localVideo.srcObject = state.localStream;
        console.log('Local stream obtained:', state.localStream);
        state.localStream.getAudioTracks().forEach(track => console.log('Local audio track:', track));
        state.localStream.getVideoTracks().forEach(track => console.log('Local video track:', track));
        return state.localStream;
    } catch (error) {
        console.error('Error getting user media:', error);
        showModal('Media Error', 'Could not get access to camera/microphone. Please ensure permissions are granted.');
        return null;
    }
}

function createPeerConnection() {
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ],
    });
    console.log('RTCPeerConnection created.');

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtc-ice-candidate', {
                targetUserId: state.activeFriendId,
                candidate: event.candidate,
            });
        }
    };

    pc.ontrack = (event) => {
        console.log('Remote track received:', event.streams[0]);
        state.remoteStream = event.streams[0];
        ELEMENTS.remoteVideo.srcObject = state.remoteStream;
    };

    pc.onnegotiationneeded = async () => {
        try {
            if (state.isCalling) { // Only create offer if initiating call
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit('webrtc-offer', {
                    targetUserId: state.activeFriendId,
                    offer: pc.localDescription,
                });
            }
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    };

    state.peerConnection = pc;
    return pc;
}

async function startCall(friendId, callType) {
    if (!state.userId || !friendId) return;
    state.activeFriendId = friendId; // Ensure activeFriendId is set for signaling
    state.isCalling = true;
    state.currentCallType = callType;

    ELEMENTS.activeCallOverlay.classList.remove('hidden');
    ELEMENTS.videoCallButton.classList.add('hidden'); // Hide call buttons when call is active
    ELEMENTS.voiceCallButton.classList.add('hidden'); // Hide call buttons when call is active

    if (callType === 'audio') {
        ELEMENTS.localVideo.style.display = 'none';
        ELEMENTS.remoteVideo.style.display = 'none';
    } else {
        ELEMENTS.localVideo.style.display = 'block';
        ELEMENTS.remoteVideo.style.display = 'block';
    }

    const stream = await getMedia(callType === 'video', true); // Get video if video call, always get audio
    if (!stream) {
        endCall();
        return;
    }

    const pc = createPeerConnection();
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    socket.emit('call-request', { targetUserId: friendId, callType });
    console.log(`Initiated ${callType} call to ${friendId}`);
}

async function handleIncomingCall(callerId, callerUsername, callType) {
    if (state.isCalling || state.isReceivingCall) {
        // Already in a call or receiving one, decline new incoming call
        socket.emit('call-response', { targetUserId: callerId, accepted: false, callType });
        return;
    }

    state.isReceivingCall = true;
    state.currentCallerId = callerId;
    state.currentCallerUsername = callerUsername;
    state.currentCallType = callType;

    ELEMENTS.incomingCallerUsername.textContent = callerUsername;
    ELEMENTS.incomingCallType.textContent = `(${callType} call)`;
    ELEMENTS.incomingCallModal.classList.remove('hidden');
}

async function acceptCall() {
    ELEMENTS.incomingCallModal.classList.add('hidden');
    ELEMENTS.activeCallOverlay.classList.remove('hidden');
    ELEMENTS.videoCallButton.classList.add('hidden'); // Hide call buttons when call is active
    ELEMENTS.voiceCallButton.classList.add('hidden'); // Hide call buttons when call is active

    state.isReceivingCall = false;
    state.isCalling = true; // Now in an active call

    if (state.currentCallType === 'audio') {
        ELEMENTS.localVideo.style.display = 'none';
        ELEMENTS.remoteVideo.style.display = 'none';
    } else {
        ELEMENTS.localVideo.style.display = 'block';
        ELEMENTS.remoteVideo.style.display = 'block';
    }

    const stream = await getMedia(state.currentCallType === 'video', true);
    if (!stream) {
        endCall();
        return;
    }

    const pc = createPeerConnection();
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    socket.emit('call-response', { targetUserId: state.currentCallerId, accepted: true, callType: state.currentCallType });
    console.log(`Accepted ${state.currentCallType} call from ${state.currentCallerId}`);
}

function declineCall() {
    ELEMENTS.incomingCallModal.classList.add('hidden');
    socket.emit('call-response', { targetUserId: state.currentCallerId, accepted: false, callType: state.currentCallType });
    resetCallState();
    console.log(`Declined ${state.currentCallType} call from ${state.currentCallerId}`);
}

function endCall() {
    if (state.peerConnection) {
        state.peerConnection.close();
        state.peerConnection = null;
    }
    if (state.localStream) {
        state.localStream.getTracks().forEach(track => track.stop());
        state.localStream = null;
    }
    if (state.remoteStream) {
        state.remoteStream.getTracks().forEach(track => track.stop());
        state.remoteStream = null;
    }

    ELEMENTS.activeCallOverlay.classList.add('hidden');
    ELEMENTS.incomingCallModal.classList.add('hidden');
    ELEMENTS.videoCallButton.classList.remove('hidden'); // Show call buttons again
    ELEMENTS.voiceCallButton.classList.remove('hidden'); // Show call buttons again

    ELEMENTS.localVideo.style.display = 'block';
    ELEMENTS.remoteVideo.style.display = 'block';

    if (state.activeFriendId && state.isCalling) { // Only emit call-end if it was an active call
        socket.emit('call-end', { targetUserId: state.activeFriendId });
    }
    resetCallState();
    console.log('Call ended.');
}

function resetCallState() {
    state.isCalling = false;
    state.isReceivingCall = false;
    state.currentCallType = null;
    state.currentCallerId = null;
    state.currentCallerUsername = null;
}

function toggleAudio() {
    if (state.localStream) {
        const audioTrack = state.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            ELEMENTS.toggleAudioButton.classList.toggle('bg-gray-700', audioTrack.enabled);
            ELEMENTS.toggleAudioButton.classList.toggle('bg-red-500', !audioTrack.enabled);

            // Update icon
            const iconPath = ELEMENTS.toggleAudioButton.querySelector('path');
            if (audioTrack.enabled) {
                iconPath.setAttribute('d', 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z'); // Microphone icon
            } else {
                iconPath.setAttribute('d', 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3zM18.364 5.636l-12.728 12.728'); // Muted microphone icon (cross out)
            }
        }
    }
}

async function toggleVideo() {
    if (!state.peerConnection) {
        console.log('toggleVideo: no peer connection');
        return;
    }

    const videoTrack = state.localStream.getVideoTracks()[0];

    if (videoTrack) {
        console.log('toggleVideo: toggling existing video track');
        // Video track exists, so just toggle it
        videoTrack.enabled = !videoTrack.enabled;
        ELEMENTS.toggleVideoButton.classList.toggle('bg-gray-700', videoTrack.enabled);
        ELEMENTS.toggleVideoButton.classList.toggle('bg-red-500', !videoTrack.enabled);
    } else {
        console.log('toggleVideo: upgrading to video call');
        // No video track, so upgrade to video call
        try {
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const newVideoTrack = videoStream.getVideoTracks()[0];
            console.log('toggleVideo: got new video track', newVideoTrack);

            // Add the new video track to the peer connection
            console.log('toggleVideo: adding track to peer connection');
            state.peerConnection.addTrack(newVideoTrack, state.localStream);

            // Add the new video track to the local stream
            console.log('toggleVideo: adding track to local stream');
            state.localStream.addTrack(newVideoTrack);

            // Update the video elements
            console.log('toggleVideo: updating video elements');
            ELEMENTS.localVideo.srcObject = state.localStream;
            ELEMENTS.localVideo.style.display = 'block';
            ELEMENTS.remoteVideo.style.display = 'block';

            // Update the call type
            console.log('toggleVideo: updating call type');
            state.currentCallType = 'video';

        } catch (error) {
            console.error('Error upgrading to video call:', error);
            showModal('Media Error', 'Could not get access to camera. Please ensure permissions are granted.');
        }
    }
}

function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('Connected to server');
        if (state.userId) {
            socket.emit('authenticate', state.userId);
        }
    });

    socket.on('auth-success', (user) => {
        console.log('Authentication successful', user);
        state.user = user;
        localStorage.setItem('user', JSON.stringify(user));
        updateUserInfoUI();
        socket.emit('get-initial-data');
    });

    socket.on('friends-list', (friends) => {
        state.friends = friends; // Store friends in state
        renderFriendList(friends);
    });
    socket.on('requests-list', renderPendingRequests);
    socket.on('messages-history', renderMessages);
    socket.on('new-message', ({ conversationId, message }) => {
        console.log(`New message received for conversation ${conversationId}. Current active conversation is ${state.activeConversationId}`);
        if (conversationId === state.activeConversationId) {
            renderMessages({ conversationId, append: true, messages: [message] });
            // If the user is currently in this conversation, mark the message as read.
            if (state.userId && conversationId) {
                socket.emit('messages-read', { conversationId, readerId: state.userId });
            }
        }
    });

    socket.on('new-request', (request) => {
        showModal("New Friend Request", `You have a new friend request from @${request.username}.`);
        socket.emit('get-initial-data');
    });

    socket.on('reload-data', () => socket.emit('get-initial-data'));
    socket.on('status-error', (message) => ELEMENTS.searchStatus.textContent = message);
    socket.on('status-success', (message) => ELEMENTS.searchStatus.textContent = message);

    socket.on('unfriended', ({ friendId }) => {
        showModal("Unfriended", `You have unfriended a user.`);
        if (state.activeFriendId === friendId) {
            state.activeFriendId = null;
            state.activeConversationId = null;
            ELEMENTS.chatHeader.textContent = "Select a friend to start chatting";
            ELEMENTS.chatWindow.innerHTML = '';
            ELEMENTS.chatPlaceholder.classList.remove('hidden');
        }
        socket.emit('get-initial-data'); // Reload friends list
    });

    // --- CALL SYSTEM SOCKET.IO LISTENERS ---
    socket.on('incoming-call', ({ callerId, callerUsername, callType }) => {
        console.log('Incoming call:', { callerId, callerUsername, callType });
        handleIncomingCall(callerId, callerUsername, callType);
    });

    socket.on('call-response', async ({ responderId, accepted, callType }) => {
        console.log('Call response:', { responderId, accepted, callType });
        if (accepted) {
            // If call was accepted, create an answer
            const pc = state.peerConnection;
            if (pc && pc.remoteDescription) {
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit('webrtc-answer', { targetUserId: responderId, answer: pc.localDescription });
            }
        } else {
            showModal('Call Declined', `@${state.user.username} declined your ${callType} call.`);
            endCall();
        }
    });

    socket.on('webrtc-offer', async ({ senderId, offer }) => {
        console.log('Received WebRTC offer from', senderId);
        if (!state.peerConnection) {
            const stream = await getMedia(state.currentCallType === 'video', true);
            if (!stream) {
                socket.emit('call-response', { targetUserId: senderId, accepted: false, callType: state.currentCallType });
                return;
            }
            const pc = createPeerConnection();
            stream.getTracks().forEach(track => pc.addTrack(track, stream));
        }
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await state.peerConnection.createAnswer();
        await state.peerConnection.setLocalDescription(answer);
        socket.emit('webrtc-answer', { targetUserId: senderId, answer: state.peerConnection.localDescription });
    });

    socket.on('webrtc-answer', async ({ senderId, answer }) => {
        console.log('Received WebRTC answer from', senderId);
        if (state.peerConnection) {
            await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
    });

    socket.on('webrtc-ice-candidate', async ({ senderId, candidate }) => {
        console.log('Received WebRTC ICE candidate from', senderId);
        if (state.peerConnection) {
            try {
                await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                console.error('Error adding received ICE candidate', e);
            }
        }
    });

    socket.on('call-ended', ({ endedBy }) => {
        console.log('Call ended by', endedBy);
        showModal('Call Ended', `Call with @${state.user.username} has ended.`);
        endCall();
    });

    socket.on('online-status', ({ userId, isOnline }) => {
        console.log(`User ${userId} is now ${isOnline ? 'online' : 'offline'}`);
        const friendElement = document.querySelector(`#friend-${userId}`);
        if (friendElement) {
            const statusIndicator = friendElement.querySelector('.status-indicator');
            if (statusIndicator) {
                statusIndicator.classList.toggle('bg-green-500', isOnline);
                statusIndicator.classList.toggle('bg-gray-400', !isOnline);
            }
        }
    });

    socket.on('friends-online-status', (friendStatuses) => {
        console.log('Initial friends online status:', friendStatuses);
        friendStatuses.forEach(({ userId, isOnline }) => {
            const friendElement = document.querySelector(`#friend-${userId}`);
            if (friendElement) {
                const statusIndicator = friendElement.querySelector('.status-indicator');
                if (statusIndicator) {
                    statusIndicator.classList.toggle('bg-green-500', isOnline);
                    statusIndicator.classList.toggle('bg-gray-400', !isOnline);
                }
            }
        });
    });

    socket.on('typing-status', ({ conversationId, userId, isTyping }) => {
        if (conversationId === state.activeConversationId && userId === state.activeFriendId) {
            const activeFriend = state.friends.find(f => f.id === userId); // Use state.friends
            const friendUsername = activeFriend ? activeFriend.username : 'Someone';
            if (isTyping) {
                ELEMENTS.chatHeader.textContent = `${friendUsername} is typing...`;
            } else {
                if (activeFriend) {
                    ELEMENTS.chatHeader.textContent = `Chatting with: @${activeFriend.username}`;
                } else {
                    ELEMENTS.chatHeader.textContent = "Select a friend to start chatting";
                }
            }
        }
    });

    socket.on('message-read', ({ conversationId, readerId }) => {
        console.log(`'message-read' event received for conversation ${conversationId}. Reader: ${readerId}`);
        if (conversationId === state.activeConversationId) {
            // Re-render messages to show read receipts
            console.log('Re-fetching messages to show read receipts.');
            socket.emit('get-messages', conversationId);
        }
    });
}

// --- AUTHENTICATION ---

// --- BACKGROUND CUSTOMIZATION FUNCTIONS ---
function applyChatBackground() {
    const chatWindow = ELEMENTS.chatWindow;
    chatWindow.style.backgroundColor = ''; // Clear any previous color

    if (state.chatBackgroundColor) {
        chatWindow.style.backgroundColor = state.chatBackgroundColor;
    }
}

function resetChatBackground() {
    state.chatBackgroundColor = null;
    localStorage.removeItem('chatBackgroundColor');
    applyChatBackground();
    ELEMENTS.backgroundColorPicker.value = '#ffffff'; // Reset color picker
}

window.handleBackgroundColorChange = (event) => {
    state.chatBackgroundColor = event.target.value;
    localStorage.setItem('chatBackgroundColor', state.chatBackgroundColor);
    applyChatBackground();
};





// --- AUTHENTICATION ---

function setAuthStatus(message, isError = false) {
    ELEMENTS.authStatus.textContent = message;
    ELEMENTS.authStatus.className = `text-center mt-4 text-sm ${isError ? 'text-red-500' : 'text-green-500'} h-6`;
}

window.handleSignUp = async () => {
    const email = ELEMENTS.authEmail.value.trim();
    const password = ELEMENTS.authPassword.value.trim();
    setAuthStatus("Processing...");
    try {
        const user = await apiRequest('/api/register', 'POST', { email, password });
        console.log('handleSignUp: loginUser called with user:', user); // Added log
        setAuthStatus("Registration successful! Logging in...");
        loginUser(user);
    } catch (error) {
        setAuthStatus(error.message, true);
    }
};

window.handleSignIn = async () => {
    const email = ELEMENTS.authEmail.value.trim();
    const password = ELEMENTS.authPassword.value.trim();
    setAuthStatus("Processing...");
    try {
        const user = await apiRequest('/api/login', 'POST', { email, password });
        console.log('handleSignIn: loginUser called with user:', user); // Added log
        loginUser(user);
    } catch (error) {
        setAuthStatus(error.message, true);
    }
};

function loginUser(user) {
    console.log('loginUser function called with user:', user); // Added log
    state.userId = user.id;
    state.user = user;
    localStorage.setItem('userId', user.id);
    localStorage.setItem('user', JSON.stringify(user));

    ELEMENTS.authModal.classList.add('hidden');
    ELEMENTS.appContainer.classList.remove('hidden');
    socket.emit('authenticate', state.userId);
    toggleMobileView(false);
}

window.handleSignOut = () => {
    console.log('Signing out. Clearing activeConversationId.');
    state = { userId: null, token: null, user: null, activeFriendId: null, activeConversationId: null, selectedFile: null };
    localStorage.clear();
    ELEMENTS.appContainer.classList.add('hidden');
    ELEMENTS.authModal.classList.remove('hidden');
    if (socket) socket.disconnect().connect();
};

// --- PROFILE --- 

window.handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) {
        state.selectedFile = null;
        ELEMENTS.pfpLabel.textContent = 'Choose File (Max 1MB)';
        ELEMENTS.pfpPreview.src = state.user?.avatarUrl || PLACEHOLDER_AVATAR;
        return;
    }
    if (file.size > MAX_FILE_SIZE) {
        showModal("File Error", "Image must be smaller than 1MB.");
        state.selectedFile = null;
        return;
    }
    state.selectedFile = file;
    ELEMENTS.pfpLabel.textContent = `Selected: ${file.name.substring(0, 15)}...`;
    ELEMENTS.pfpPreview.src = URL.createObjectURL(file);
};

window.handleSaveProfile = async () => {
    if (!state.userId) return showModal("Error", "You are not signed in.");

    const newUsername = ELEMENTS.usernameInput.value.trim();
    ELEMENTS.usernameStatus.textContent = '';
    ELEMENTS.saveProfileButton.disabled = true;
    ELEMENTS.saveProfileButton.textContent = "Saving...";

    const formData = new FormData();
    formData.append('username', newUsername);
    if (state.selectedFile) {
        formData.append('avatar', state.selectedFile);
    }

    try {
        const response = await fetch('/api/profile', {
            method: 'POST',
            headers: { 'x-user-id': state.userId },
            body: formData,
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message);
        }
        const { user } = await response.json();
        state.user = user;
        localStorage.setItem('user', JSON.stringify(user));
        state.selectedFile = null;
        ELEMENTS.pfpUploadInput.value = '';
        ELEMENTS.pfpLabel.textContent = 'Choose File (Max 1MB)';
        updateUserInfoUI();
        showModal("Success", "Profile updated successfully!");
    } catch (error) {
        ELEMENTS.usernameStatus.textContent = error.message;
    } finally {
        ELEMENTS.saveProfileButton.disabled = false;
        ELEMENTS.saveProfileButton.textContent = "Save Profile Settings";
    }
};

// --- FRIENDS & REQUESTS ---

window.handleSendRequest = () => {
    const targetUsername = ELEMENTS.friendIdInput.value.trim();
    if (!targetUsername) return;
    if (!state.user.username) {
        return showModal("Error", "Please set your own username before adding friends.");
    }
    ELEMENTS.searchStatus.textContent = `Sending request to @${targetUsername}...`;
    socket.emit('send-friend-request', targetUsername);
    ELEMENTS.friendIdInput.value = '';
};

window.handleAcceptRequest = (senderId) => {
    socket.emit('accept-friend-request', senderId);
};

window.handleUnfriend = (friendId, friendUsername) => {
    if (confirm(`Are you sure you want to unfriend @${friendUsername}?`)) {
        socket.emit('unfriend', { friendId });
    }
};

function renderPendingRequests(requests) {
    ELEMENTS.requestsList.innerHTML = '';
    ELEMENTS.requestCount.textContent = requests.length;
    ELEMENTS.noRequests.classList.toggle('hidden', requests.length > 0);
    requests.forEach(req => {
        const item = document.createElement('div');
        item.className = 'p-3 bg-yellow-100 dark:bg-yellow-800 dark:text-yellow-100 rounded-lg shadow-sm flex justify-between items-center';
        item.innerHTML = `
            <span class="font-semibold">@${req.username}</span>
            <button onclick="handleAcceptRequest('${req.id}')" class="ml-2 px-3 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700">Accept</button>
        `;
        ELEMENTS.requestsList.appendChild(item);
    });
}

function renderFriendList(friends) {
    ELEMENTS.friendsList.innerHTML = '';
    ELEMENTS.noFriends.classList.toggle('hidden', friends.length > 0);
    friends.forEach(friend => {
        const item = document.createElement('button');
        const isActive = state.activeFriendId === friend.id;
        item.id = `friend-${friend.id}`; // Add an ID to the friend element
        item.className = `w-full text-left p-3 rounded-lg flex items-center justify-between ${isActive ? 'bg-indigo-200 dark:bg-indigo-700' : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200'}`;
        item.innerHTML = `
            <div class="flex items-center">
                <img src="${friend.avatarUrl}" class="w-8 h-8 rounded-full mr-3" onerror="this.src='${PLACEHOLDER_AVATAR}'">
                <span class="truncate font-semibold">@${friend.username}</span>
                <span class="status-indicator w-3 h-3 rounded-full ml-2 bg-gray-400"></span> <!-- Status indicator -->
            </div>
            <button onclick="handleUnfriend('${friend.id}', '${friend.username}')" class="unfriend-button ml-2 px-3 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600">Unfriend</button>
        `;
        item.onclick = (event) => {
            // Only select friend if the click target is not the unfriend button
            if (!event.target.closest('.unfriend-button')) { // Added a class to the unfriend button for better targeting
                selectFriend(friend.id, friend.conversationId, friend.username);
            }
        };
        ELEMENTS.friendsList.appendChild(item);
    });
}

// --- CHAT ---

function selectFriend(friendId, conversationId, friendUsername) {
    if (state.activeFriendId === friendId && window.innerWidth < 768 && !ELEMENTS.chatPanel.classList.contains('hidden')) return;
    
    console.log(`Selecting friend. New activeConversationId: ${conversationId}`);
    state.activeFriendId = friendId;
    state.activeConversationId = conversationId;
    ELEMENTS.chatHeader.textContent = `Chatting with: @${friendUsername}`;
    ELEMENTS.messageInput.disabled = false;
    ELEMENTS.sendButton.disabled = false;
    ELEMENTS.messageInput.focus();

    // Show call buttons when a friend is selected
    ELEMENTS.videoCallButton.classList.remove('hidden');
    ELEMENTS.voiceCallButton.classList.remove('hidden');
    
    socket.emit('get-messages', conversationId);
    toggleMobileView(true);
    renderFriendList(state.friends); // Use state.friends directly

    // Emit messages-read event
    if (state.userId && conversationId) {
        socket.emit('messages-read', { conversationId, readerId: state.userId });
    }
}

function renderMessages({ conversationId, messages, append = false }) {
    if (conversationId !== state.activeConversationId) return;
    if (!append) {
        ELEMENTS.chatWindow.innerHTML = '';
    }
    ELEMENTS.chatPlaceholder.classList.toggle('hidden', messages.length > 0 || !append);

    messages.forEach(msg => {
        const msgEl = document.createElement('div');
        const isSelf = msg.userId === state.userId;
        msgEl.className = `flex ${isSelf ? 'justify-end' : 'justify-start'}`;

        let readIndicator = '';
        if (isSelf && msg.readBy && msg.readBy.length > 0) {
            readIndicator = `<span class="text-xs text-gray-500 ml-1">Read</span>`;
        }

        let fileContent = '';
        if (msg.fileUrl) {
            if (msg.fileUrl.match(/\.(jpeg|jpg|gif|png)$/)) {
                fileContent = `<img src="${msg.fileUrl}" class="max-w-xs max-h-48 rounded-lg mt-2" />`;
            } else if (msg.fileUrl.match(/\.(mp4|webm|ogg)$/)) {
                fileContent = `<video src="${msg.fileUrl}" controls class="max-w-xs max-h-48 rounded-lg mt-2"></video>`;
            }
        }

        msgEl.innerHTML = `
            <div class="message-bubble ${isSelf ? 'message-self' : 'message-other'}">
                <p class="text-base">${msg.text}</p>
                ${fileContent}
                <span class="text-xs block mt-1 text-right">${new Date(msg.timestamp).toLocaleTimeString()} ${readIndicator}</span >
            </div>`;
        ELEMENTS.chatWindow.appendChild(msgEl);
    });
    ELEMENTS.chatWindow.scrollTop = ELEMENTS.chatWindow.scrollHeight;
}

async function sendMessage(e) {
    e.preventDefault();
    const text = ELEMENTS.messageInput.value.trim();
    if (!text && !state.selectedMessageFile) return;

    let fileUrl = null;
    if (state.selectedMessageFile) {
        const formData = new FormData();
        formData.append('chat-file', state.selectedMessageFile);
        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'x-user-id': state.userId },
                body: formData,
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message);
            }
            const data = await response.json();
            fileUrl = data.fileUrl;
        } catch (error) {
            showModal('Upload Error', error.message);
            return;
        }
    }

    socket.emit('send-message', {
        conversationId: state.activeConversationId,
        text,
        fileUrl,
    });

    ELEMENTS.messageInput.value = '';
    state.selectedMessageFile = null;
    ELEMENTS.fileInput.value = '';
    ELEMENTS.filePreviewContainer.classList.add('hidden');
}

window.handleChatMessageFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) { // 10MB limit for chat files
        showModal("File Error", "File must be smaller than 10MB.");
        return;
    }

    state.selectedMessageFile = file;
    ELEMENTS.filePreviewImage.src = URL.createObjectURL(file);
    ELEMENTS.filePreviewContainer.classList.remove('hidden');
};



// --- TABS ---
window.switchTab = (tab) => {
    const friendsButton = document.getElementById('tab-friends');
    const requestsButton = document.getElementById('tab-requests');
    if (tab === 'friends') {
        friendsButton.classList.add('bg-indigo-100', 'dark:bg-indigo-900');
        requestsButton.classList.remove('bg-indigo-100', 'dark:bg-indigo-900');
        ELEMENTS.friendsList.classList.remove('hidden');
        ELEMENTS.requestsList.classList.add('hidden');
    } else {
        requestsButton.classList.add('bg-indigo-100', 'dark:bg-indigo-900');
        friendsButton.classList.remove('bg-indigo-100', 'dark:bg-indigo-900');
        ELEMENTS.requestsList.classList.remove('hidden');
        ELEMENTS.friendsList.classList.add('hidden');
    }
};

// --- INITIALIZATION ---
function main() {
    setupSocketListeners();
    ELEMENTS.messageForm.addEventListener('submit', sendMessage);

    ELEMENTS.settingsButton.addEventListener('click', () => {
        ELEMENTS.settingsMenu.classList.toggle('hidden');
    });

    ELEMENTS.attachFileButton.addEventListener('click', () => {
        ELEMENTS.fileInput.click();
    });

    ELEMENTS.fileInput.addEventListener('change', handleChatMessageFileSelect);

    ELEMENTS.cancelFileButton.addEventListener('click', () => {
        state.selectedMessageFile = null;
        ELEMENTS.fileInput.value = '';
        ELEMENTS.filePreviewContainer.classList.add('hidden');
    });

    ELEMENTS.messageInput.addEventListener('input', () => {
        if (!state.activeConversationId || !state.userId) return;

        socket.emit('typing-start', { conversationId: state.activeConversationId, userId: state.userId });

        if (typingTimeout[state.activeConversationId]) {
            clearTimeout(typingTimeout[state.activeConversationId]);
        }

        typingTimeout[state.activeConversationId] = setTimeout(() => {
            socket.emit('typing-stop', { conversationId: state.activeConversationId, userId: state.userId });
            delete typingTimeout[state.activeConversationId];
        }, 1500);
    });

    ELEMENTS.signInButton.addEventListener('click', handleSignIn);
    ELEMENTS.signUpButton.addEventListener('click', handleSignUp);

    // Call system event listeners
    ELEMENTS.videoCallButton.addEventListener('click', () => startCall(state.activeFriendId, 'video'));
    ELEMENTS.voiceCallButton.addEventListener('click', () => startCall(state.activeFriendId, 'audio'));
    ELEMENTS.acceptCallButton.addEventListener('click', acceptCall);
    ELEMENTS.declineCallButton.addEventListener('click', declineCall);
    ELEMENTS.endCallButton.addEventListener('click', endCall);
    ELEMENTS.toggleAudioButton.addEventListener('click', toggleAudio);
    ELEMENTS.toggleVideoButton.addEventListener('click', toggleVideo);

    // Background customization event listeners
    ELEMENTS.backgroundColorPicker.addEventListener('change', window.handleBackgroundColorChange);
    ELEMENTS.resetBackgroundButton.addEventListener('click', resetChatBackground);

    if (state.userId) {
        ELEMENTS.authModal.classList.add('hidden');
        ELEMENTS.appContainer.classList.remove('hidden');
        toggleMobileView(false);
        applyChatBackground(); // Apply saved background on load
    } else {
        ELEMENTS.appContainer.classList.add('hidden');
        ELEMENTS.authModal.classList.remove('hidden');
    }
}

main();