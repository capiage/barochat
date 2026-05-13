
import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/module.esm.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, addDoc, deleteDoc, getDocs, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { SVGS, FAVICONS } from './constants.js';

window.nexusApp = () => ({
    isReady: false,
    authLoading: true,
    authMode: 'login', 
    authUsername: '', authPassword: '', authDisplayName: '', authAvatar: SVGS.C,
    defaultAvatars: [{ data: SVGS.C }, { data: SVGS.PERSON }, { data: SVGS.PEN }, { data: SVGS.HAT }],
    
    logicalUid: null, 
    currentUserProfile: null,
    
    toast: { show: false, message: '', isError: false, timeout: null },
    showImagePreview: false, previewImageUrl: '',

    // Modals & Popouts
    showSettingsModal: false, editProfile: {},
    showProfilePopout: false, popoutUser: null,
    showCreateServerModal: false, newServerName: '', newServerIcon: null,
    showServerSettingsModal: false, serverSettingsTab: 'overview', editServer: {}, newChannelName: '', newChannelType: 'text',
    
    // Navigation & UI
    activeView: 'home', 
    activeTarget: null, 
    activeChannelId: null, 
    showMembersList: true,
    viewingVoice: false,
    friendsTab: 'all', 
    fullscreenVideoId: null,
    
    // Message Input
    newMessage: '', pendingImage: null, editingMessageId: null,
    showMentions: false, mentionQuery: '', filteredMentionUsers: [], mentionIndex: 0,
    directFriendRequestUsername: '',
    
    // Data
    servers: [], dms: [], messages: [], filteredMessages: [], users: {}, globalPresence: [],
    
    get myServers() { return this.servers.filter(s => this.currentUserProfile?.joinedServers?.includes(s.id)); },
    get discoveryServers() { return this.servers.filter(s => s.isPublic && !this.currentUserProfile?.joinedServers?.includes(s.id)); },
    get currentChatId() { return this.activeView === 'server' ? this.activeChannelId : this.activeTarget; },
    
    // Friend Logic
    get myFriendsList() {
        const myFriends = this.currentUserProfile?.friends || [];
        return Object.values(this.users).filter(u => myFriends.includes(u.uid) && u.friends?.includes(this.logicalUid));
    },
    get incomingFriendRequests() {
        const myFriends = this.currentUserProfile?.friends || [];
        return Object.values(this.users).filter(u => u.friends?.includes(this.logicalUid) && !myFriends.includes(u.uid));
    },
    get outgoingFriendRequests() {
        const myFriends = this.currentUserProfile?.friends || [];
        return Object.values(this.users).filter(u => myFriends.includes(u.uid) && !u.friends?.includes(this.logicalUid));
    },

    // DM Logic
    get sortedDms() {
        return this.dms.slice().sort((a, b) => {
            const lastA = this.getLastMessageTimestamp(a.id);
            const lastB = this.getLastMessageTimestamp(b.id);
            return lastB - lastA;
        });
    },
    getLastMessageTimestamp(roomId) {
        const msgs = this.messages.filter(m => m.roomId === roomId);
        return msgs.length === 0 ? 0 : msgs[msgs.length - 1].timestamp;
    },
    get totalUnreadDms() {
        return this.dms.filter(dm => this.hasUnread(dm.id) && this.activeTarget !== dm.id).length;
    },
    hasUnread(roomId) {
        if (!roomId || !this.messages) return false;
        const msgs = this.messages.filter(m => m.roomId === roomId);
        if (msgs.length === 0) return false;
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg.senderId === this.logicalUid) return false; 
        const lastRead = this.currentUserProfile?.lastRead?.[roomId] || 0;
        return lastMsg.timestamp > lastRead;
    },
    markRead(roomId) {
        if (!roomId || !this.logicalUid || !this.currentUserProfile) return;
        const lr = this.currentUserProfile.lastRead || {};
        lr[roomId] = Date.now();
        updateDoc(doc(this.usersRef, this.logicalUid), { lastRead: lr });
        this.updateFavicon();
    },
    updateFavicon() {
        const link = document.getElementById('dynamic-favicon');
        if (link) {
            link.href = this.totalUnreadDms > 0 ? FAVICONS.ALERT : FAVICONS.ANIMATED;
        }
    },

    // Message Grouping
    get groupedMessages() {
        if (!this.filteredMessages || this.filteredMessages.length === 0) return [];
        const groups = [];
        let currentGroup = null;
        for (const msg of this.filteredMessages) {
            if (!currentGroup || currentGroup.senderId !== msg.senderId || (msg.timestamp - currentGroup.lastTimestamp) > 300000) {
                currentGroup = {
                    id: msg.id + '_grp',
                    senderId: msg.senderId,
                    timestamp: msg.timestamp,
                    lastTimestamp: msg.timestamp,
                    messages: [msg]
                };
                groups.push(currentGroup);
            } else {
                currentGroup.messages.push(msg);
                currentGroup.lastTimestamp = msg.timestamp;
            }
        }
        return groups;
    },
    
    formatMessage(text) {
        if (!text) return '';
        let safe = text.replace(/[&<>'"]/g, tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag]));
        // Highlight mentions and make them clickable
        safe = safe.replace(/@([a-zA-Z0-9_]+)/g, (match, username) => {
            const user = Object.values(this.users).find(u => u.username === username.toLowerCase());
            if (user) {
                return `<span class="text-[#5865F2] bg-[#5865F2]/20 px-1 rounded font-medium cursor-pointer hover:underline" onclick="window.nexusAction('openProfile', '${user.uid}')">@${username}</span>`;
            }
            return match;
        });
        return safe;
    },
    isMentioned(text) {
        if(!this.currentUserProfile || !this.currentUserProfile.username || !text) return false;
        return text.toLowerCase().includes('@' + this.currentUserProfile.username.toLowerCase());
    },
    
    checkMentions() {
        const match = this.newMessage.match(/@([a-zA-Z0-9_]*)$/);
        if (match) {
            this.showMentions = true;
            this.mentionQuery = match[1].toLowerCase();
            let availableUsers = [];
            if (this.activeView === 'server') availableUsers = this.getServerMembers('all');
            else if (this.activeView === 'home' && this.activeTarget) availableUsers = [this.getUser(this.getDmPartner(this.activeTarget))];
            
            this.filteredMentionUsers = availableUsers.filter(u => 
                u && (u.username.toLowerCase().includes(this.mentionQuery) || u.displayName.toLowerCase().includes(this.mentionQuery))
            );
            this.mentionIndex = 0;
        } else {
            this.showMentions = false;
        }
    },
    handleMentionKey(e) {
        if (!this.showMentions) return;
        if (e.key === 'Tab' || e.key === 'Enter') {
            e.preventDefault();
            if (this.filteredMentionUsers.length > 0) {
                this.insertMention(this.filteredMentionUsers[this.mentionIndex].username);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.mentionIndex = (this.mentionIndex - 1 + this.filteredMentionUsers.length) % this.filteredMentionUsers.length;
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.mentionIndex = (this.mentionIndex + 1) % this.filteredMentionUsers.length;
        }
    },
    insertMention(username) {
        this.newMessage = this.newMessage.replace(/@([a-zA-Z0-9_]*)$/, '@' + username + ' ');
        this.showMentions = false;
        this.$refs.chatInput.focus();
    },

    getAvatarColor(avatar) {
        if (!avatar) return '#5865F2';
        // Better color selection based on avatar content if possible, or fallback to hash-based color
        let hash = 0;
        for (let i = 0; i < avatar.length; i++) {
            hash = avatar.charCodeAt(i) + ((hash << 5) - hash);
        }
        const colors = ['#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245', '#1ABC9C', '#3498DB', '#9B59B6'];
        return colors[Math.abs(hash) % colors.length];
    },

    // WebRTC State
    inVoiceRoom: null, voicePeers: {}, 
    rtcVideoOff: true, isMuted: false, isDeafened: false, isScreenSharing: false,
    localStream: null, screenStream: null, simplePeers: {},

    db: null, auth: null, publicDataPath: '', usersRef: null, accountsRef: null, heartbeatInterval: null,

    async init() {
        try {
            const config = { apiKey: "AIzaSyDUoYS6MwDIVe8coZOM9A0ZCYaZTeDSloo", authDomain: "babjeu-85d3e.firebaseapp.com", databaseURL: "https://babjeu-85d3e-default-rtdb.firebaseio.com", projectId: "babjeu-85d3e", storageBucket: "babjeu-85d3e.firebasestorage.app", messagingSenderId: "306959176803", appId: "1:306959176803:web:2be00da38dbb37e777d456" };
            const app = initializeApp(config);
            this.db = getFirestore(app);
            this.auth = getAuth(app);
            
            this.publicDataPath = `artifacts/le-barochat/public/data_v4`;
            this.usersRef = collection(this.db, `${this.publicDataPath}/users`);
            this.accountsRef = collection(this.db, `${this.publicDataPath}/accounts`);

            await signInAnonymously(this.auth);

            const savedSession = localStorage.getItem('lebarochat_session_v4');
            if (savedSession) {
                this.logicalUid = savedSession;
                await this.loadLogicalProfile();
            } else {
                this.authLoading = false;
                this.isReady = false;
            }

            // Expose actions for inline HTML
            window.nexusAction = (type, data) => {
                if (type === 'openProfile') this.openProfilePopout(data);
            };

            this.$watch('filteredMessages', () => {
                this.$nextTick(() => {
                    const c = document.getElementById('chatContainer');
                    if(c) c.scrollTop = c.scrollHeight;
                });
                if(this.currentChatId && this.messages.length > 0) {
                    const lastMsg = this.messages[this.messages.length - 1];
                    if(lastMsg.roomId === this.currentChatId) this.markRead(this.currentChatId);
                }
            });
            this.$watch('currentChatId', (val) => { this.filterMessages(); this.markRead(val); });
            
            window.addEventListener('beforeunload', () => {
                if(this.logicalUid) setDoc(doc(this.db, `${this.publicDataPath}/presence`, this.logicalUid), { status: 'offline' }, { merge: true });
            });

            const joinId = new URLSearchParams(window.location.search).get('join');
            if (joinId) {
                window.history.replaceState({}, document.title, window.location.pathname);
                this._pendingJoinId = joinId;
            }

            // Request Notification Permission
            if (Notification.permission === 'default') Notification.requestPermission();

        } catch (e) { 
            console.error("Init Error:", e); 
            this.showToast("Failed to connect.", true);
        }
    },

    async processAuth() {
        this.authLoading = true;
        try {
            const username = this.authUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
            if(!username) throw new Error("Invalid username.");

            if (this.authMode === 'login') {
                const snap = await getDocs(this.accountsRef);
                let found = null;
                snap.forEach(d => { if(d.data().username === username && d.data().password === this.authPassword) found = d.data(); });
                if (found) {
                    this.logicalUid = found.profileId;
                    localStorage.setItem('lebarochat_session_v4', this.logicalUid);
                    await this.loadLogicalProfile();
                } else throw new Error("Invalid credentials.");
            } else {
                const snap = await getDocs(this.accountsRef);
                let taken = false;
                snap.forEach(d => { if(d.data().username === username) taken = true; });
                if(taken) throw new Error("Username taken.");

                const pid = "user_" + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
                await setDoc(doc(this.accountsRef, pid), { username, password: this.authPassword, profileId: pid });
                const profile = {
                    uid: pid, username, displayName: this.authDisplayName.trim() || username,
                    avatar: this.authAvatar, bio: "Ready to chat!", banner: null, bannerColor: '#5865F2',
                    joinedServers: [], friends: [], lastRead: {}
                };
                await setDoc(doc(this.usersRef, pid), profile);
                this.logicalUid = pid;
                localStorage.setItem('lebarochat_session_v4', pid);
                await this.loadLogicalProfile();
            }
        } catch(e) { this.showToast(e.message, true); this.authLoading = false; }
    },

    async loadLogicalProfile() {
        if(!this.logicalUid) return;
        onSnapshot(doc(this.usersRef, this.logicalUid), (snap) => {
            if (snap.exists()) {
                this.currentUserProfile = snap.data();
                this.cacheUser(this.currentUserProfile);
                if(!this.isReady) {
                    this.startGlobalListeners();
                    this.isReady = true; this.authLoading = false;
                    if (this._pendingJoinId) { this.joinServer(this._pendingJoinId); this._pendingJoinId = null; }
                    this.updatePresence();
                    this.heartbeatInterval = setInterval(() => this.updatePresence(), 15000);
                }
            } else {
                localStorage.removeItem('lebarochat_session_v4');
                this.logicalUid = null; this.isReady = false; this.authLoading = false;
            }
        });
    },

    startGlobalListeners() {
        onSnapshot(this.usersRef, (snap) => snap.forEach(d => this.cacheUser(d.data())));
        onSnapshot(collection(this.db, `${this.publicDataPath}/servers`), (snap) => {
            const s = []; snap.forEach(d => s.push({id: d.id, ...d.data()})); this.servers = s;
        });
        onSnapshot(collection(this.db, `${this.publicDataPath}/dms`), (snap) => {
            const ds = []; 
            snap.forEach(d => {
                if (d.data().participants?.includes(this.logicalUid)) {
                    ds.push({ id: d.id, partnerUid: d.data().participants.find(p => p !== this.logicalUid) });
                }
            });
            this.dms = ds;
        });
        onSnapshot(collection(this.db, `${this.publicDataPath}/messages`), (snap) => {
            const m = []; 
            snap.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    if (data.senderId !== this.logicalUid && (this.isMentioned(data.text) || (data.roomId.includes('_') && this.dms.some(d => d.id === data.roomId)))) {
                        this.triggerNotification(data);
                    }
                }
            });
            snap.forEach(d => m.push({id: d.id, ...d.data()}));
            this.messages = m; this.filterMessages();
        });
        onSnapshot(collection(this.db, `${this.publicDataPath}/presence`), (snap) => {
            const pres = []; const now = Date.now();
            snap.forEach(d => {
                const data = d.data();
                if (now - data.lastActive < 60000 && data.status === 'online') {
                    pres.push(data);
                    if (this.inVoiceRoom && data.currentVoice === this.inVoiceRoom && data.uid !== this.logicalUid && !this.simplePeers[data.uid]) {
                        this.createPeer(data.uid, this.logicalUid < data.uid);
                    }
                }
            });
            this.globalPresence = pres;
            if(this.inVoiceRoom) {
                const current = pres.filter(p => p.currentVoice === this.inVoiceRoom).map(p => p.uid);
                Object.keys(this.simplePeers).forEach(uid => { if (!current.includes(uid)) this.removePeer(uid); });
            }
        });
        onSnapshot(collection(this.db, `${this.publicDataPath}/signaling`), (snap) => {
            snap.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    if (data.to === this.logicalUid && data.room === this.inVoiceRoom) {
                        this.handleIncomingSignal(data.from, data.signal);
                        deleteDoc(change.doc.ref); 
                    }
                }
            });
        });
    },

    triggerNotification(msg) {
        if (this.currentChatId === msg.roomId && document.visibilityState === 'visible') return;
        const sender = this.getUser(msg.senderId);
        const title = msg.roomId.includes('_') ? `Message from ${sender.displayName}` : `Ping in #${this.getChannelName(msg.roomId)}`;
        
        if (Notification.permission === 'granted') {
            new Notification(title, { body: msg.text, icon: sender.avatar });
        }
        this.showToast(`${title}: ${msg.text.substring(0, 30)}...`);
    },

    updatePresence() {
        if(!this.logicalUid) return;
        setDoc(doc(this.db, `${this.publicDataPath}/presence`, this.logicalUid), {
            uid: this.logicalUid, status: 'online', currentVoice: this.inVoiceRoom,
            isScreenSharing: this.isScreenSharing, isCameraOff: this.rtcVideoOff, isMuted: this.isMuted,
            lastActive: Date.now()
        }, { merge: true });
    },

    showToast(msg, isError = false) {
        this.toast.message = msg; this.toast.isError = isError; this.toast.show = true;
        if(this.toast.timeout) clearTimeout(this.toast.timeout);
        this.toast.timeout = setTimeout(() => { this.toast.show = false; }, 4000);
    },

    openImage(url) { this.previewImageUrl = url; this.showImagePreview = true; },
    closeImage() { this.showImagePreview = false; },

    copyToClipboard(text) {
        const el = document.getElementById('hiddenCopyTextarea');
        el.value = text; el.select(); document.execCommand('copy');
        this.showToast("Copied!");
    },

    filterMessages() {
        if (!this.currentChatId) { this.filteredMessages = []; return; }
        this.filteredMessages = this.messages.filter(m => m.roomId === this.currentChatId).sort((a, b) => a.timestamp - b.timestamp);
    },

    cacheUser(data) { if(data && data.uid) this.users[data.uid] = data; },
    getUser(uid) { return this.users[uid] || { displayName: 'User', username: 'loading', avatar: SVGS.PERSON }; },
    getServer() { return this.servers.find(s => s.id === this.activeTarget); },
    getChannelName(cid) {
        if (!cid) return '';
        if (cid.includes('_')) return this.getUser(this.getDmPartner(cid))?.displayName || 'DM';
        // Check for channel in any server
        for (const s of this.servers) {
            const c = s.channels?.find(ch => ch.id === cid);
            if (c) return c.name;
        }
        // Fallback for voice room if it's different
        if (this.inVoiceRoom && this.inVoiceRoom === cid) {
            for (const s of this.servers) {
                const c = s.channels?.find(ch => ch.id === cid);
                if (c) return c.name;
            }
        }
        return '';
    },

    isUserOnline(uid) { return this.globalPresence.some(p => p.uid === uid); },
    getServerMembers(status) {
        if(!this.activeTarget || this.activeView !== 'server') return [];
        const s = this.getServer(); if(!s) return [];
        const members = Object.values(this.users).filter(u => u.joinedServers?.includes(this.activeTarget));
        members.sort((a, b) => a.uid === s.owner ? -1 : b.uid === s.owner ? 1 : a.displayName.localeCompare(b.displayName));
        if (status === 'all') return members;
        return members.filter(m => status === 'online' ? this.isUserOnline(m.uid) : !this.isUserOnline(m.uid));
    },
    getVoiceUsers(channelId) { return this.globalPresence.filter(p => p.currentVoice === channelId); },

    openHome() { this.activeView = 'home'; this.activeTarget = null; this.activeChannelId = null; this.updatePresence(); },
    openDiscovery() { this.activeView = 'discovery'; this.activeTarget = null; this.activeChannelId = null; this.viewingVoice = false; },
    openServer(id) {
        this.activeView = 'server'; this.activeTarget = id;
        const s = this.servers.find(server => server.id === id);
        if (s?.channels) {
            const texts = s.channels.filter(c => c.type === 'text');
            this.activeChannelId = texts.length > 0 ? texts[0].id : null;
        }
        this.updatePresence();
    },

    getDmPartner(dmId) { return this.dms.find(d => d.id === dmId)?.partnerUid; },
    openDM(id) { this.activeView = 'home'; this.activeTarget = id; this.activeChannelId = null; this.viewingVoice = (this.inVoiceRoom === id); this.markRead(id); },
    async initiateDM(uid) {
        const id = [this.logicalUid, uid].sort().join('_');
        if (!this.dms.some(d => d.id === id)) await setDoc(doc(this.db, `${this.publicDataPath}/dms`, id), { participants: [this.logicalUid, uid].sort() });
        this.showProfilePopout = false; this.openDM(id);
    },
    
    isFriend(uid) { return this.currentUserProfile?.friends?.includes(uid) && this.getUser(uid)?.friends?.includes(this.logicalUid); },
    isPendingOutgoing(uid) { return this.currentUserProfile?.friends?.includes(uid) && !this.getUser(uid)?.friends?.includes(this.logicalUid); },
    isPendingIncoming(uid) { return !this.currentUserProfile?.friends?.includes(uid) && this.getUser(uid)?.friends?.includes(this.logicalUid); },
    
    async addFriend(uid) {
        const friends = [...(this.currentUserProfile.friends || []), uid];
        await updateDoc(doc(this.usersRef, this.logicalUid), { friends });
        this.showToast("Request processed.");
    },
    async removeFriend(uid) {
        const friends = (this.currentUserProfile.friends || []).filter(id => id !== uid);
        await updateDoc(doc(this.usersRef, this.logicalUid), { friends });
    },
    
    sendDirectFriendRequest() {
        const name = this.directFriendRequestUsername.replace('@', '').toLowerCase();
        const u = Object.values(this.users).find(u => u.username === name);
        if (u) { this.addFriend(u.uid); this.directFriendRequestUsername = ''; }
        else this.showToast("Not found.", true);
    },

    openProfilePopout(uid) { this.popoutUser = this.getUser(uid); this.showProfilePopout = !!this.popoutUser; },

    getChatPlaceholder() {
        if (this.activeView === 'home' && this.activeTarget) return `Message @${this.getUser(this.getDmPartner(this.activeTarget))?.username}`;
        return `Message #${this.getChannelName(this.activeChannelId)}`;
    },

    async sendMessage() {
        if (!this.currentChatId || (!this.newMessage.trim() && !this.pendingImage)) return;
        if (this.editingMessageId) {
            await updateDoc(doc(this.db, `${this.publicDataPath}/messages`, this.editingMessageId), { text: this.newMessage.trim(), edited: true });
            this.editingMessageId = null; this.newMessage = '';
        } else {
            const p = { roomId: this.currentChatId, senderId: this.logicalUid, text: this.newMessage.trim(), image: this.pendingImage, timestamp: Date.now() };
            this.newMessage = ''; this.pendingImage = null; this.showMentions = false;
            await addDoc(collection(this.db, `${this.publicDataPath}/messages`), p);
            this.markRead(this.currentChatId); 
        }
    },

    async createServer() {
        const ref = doc(collection(this.db, `${this.publicDataPath}/servers`));
        await setDoc(ref, {
            name: this.newServerName.trim(), icon: this.newServerIcon, owner: this.logicalUid, isPublic: false, banner: null, bannerColor: '#5865F2', bio: "A new community.",
            channels: [{ id: 'c1_' + Date.now(), name: 'general', type: 'text' }, { id: 'c2_' + Date.now(), name: 'Voice', type: 'voice' }]
        });
        const joined = [...(this.currentUserProfile.joinedServers || []), ref.id];
        await updateDoc(doc(this.usersRef, this.logicalUid), { joinedServers: joined });
        this.showCreateServerModal = false; this.openServer(ref.id);
    },

    async joinServer(id) {
        const joined = [...new Set([...(this.currentUserProfile.joinedServers || []), id])];
        await updateDoc(doc(this.usersRef, this.logicalUid), { joinedServers: joined });
        this.openServer(id);
    },

    openSettings() { this.editProfile = JSON.parse(JSON.stringify(this.currentUserProfile)); this.showSettingsModal = true; },
    async saveProfileSettings() {
        await updateDoc(doc(this.usersRef, this.logicalUid), { displayName: this.editProfile.displayName, bio: this.editProfile.bio, avatar: this.editProfile.avatar, banner: this.editProfile.banner });
        this.showSettingsModal = false;
    },

    openServerSettingsModal(tab = 'overview') {
        const s = this.getServer(); if(!s) return;
        this.editServer = JSON.parse(JSON.stringify(s)); 
        if(!this.editServer.channels) this.editServer.channels = [];
        this.serverSettingsTab = tab; this.showServerSettingsModal = true;
    },

    async saveServerSettings() {
        await updateDoc(doc(this.db, `${this.publicDataPath}/servers`, this.editServer.id), {
            name: this.editServer.name, icon: this.editServer.icon, isPublic: this.editServer.isPublic, channels: this.editServer.channels,
            banner: this.editServer.banner, bannerColor: this.editServer.bannerColor || '#5865F2', bio: this.editServer.bio
        });
        this.showToast("Server updated.");
    },

    triggerImageUpload(context) {
        const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
        i.onchange = (e) => this.processImage(e.target.files[0], context); i.click();
    },
    processImage(file, context) {
        if (!file) return; const r = new FileReader();
        r.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                let mw = 256, mh = 256;
                if (context === 'chat') { mw = 800; mh = 800; }
                else if (context.includes('Banner')) { mw = 600; mh = 300; }
                let w = img.width, h = img.height;
                if (w > h) { if (w > mw) { h *= mw / w; w = mw; } } else { if (h > mh) { w *= mh / h; h = mh; } }
                c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
                const data = c.toDataURL('image/jpeg', 0.8);
                if (context === 'chat') this.pendingImage = data;
                else if (context === 'setup') this.authAvatar = data;
                else if (context === 'edit') this.editProfile.avatar = data;
                else if (context === 'banner') this.editProfile.banner = data;
                else if (context === 'server') this.newServerIcon = data;
                else if (context === 'serverEdit') this.editServer.icon = data;
                else if (context === 'serverBannerEdit') this.editServer.banner = data;
            };
            img.src = e.target.result;
        };
        r.readAsDataURL(file);
    },

    // WebRTC
    async joinVoiceRoom(id) {
        if (this.inVoiceRoom) this.leaveVoiceRoom();
        try {
            this.inVoiceRoom = id; this.rtcVideoOff = true; this.isScreenSharing = false; this.viewingVoice = true; 
            // Correct Mic Init: Ensure we get a real audio track immediately
            const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
            this.localStream = stream;
            
            // Dummy video for initial peer setup
            const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
            const dummyVideo = canvas.captureStream().getVideoTracks()[0];
            this.localStream.addTrack(dummyVideo);

            this.updatePresence();
            setTimeout(() => { 
                const lv = document.getElementById('local-video');
                if(lv) lv.srcObject = this.localStream; 
            }, 500);
        } catch(e) { this.showToast("Mic failed to start.", true); }
    },

    leaveVoiceRoom() {
        if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
        if (this.screenStream) this.stopScreenShare();
        Object.values(this.simplePeers).forEach(p => p.destroy());
        this.simplePeers = {}; this.inVoiceRoom = null; this.localStream = null; this.viewingVoice = false;
        this.updatePresence();
        // Cleanup UI
        document.querySelectorAll('#fullscreen-video-grid .video-wrapper').forEach(w => {
            if(!w.innerHTML.includes('local-video')) w.remove();
        });
    },

    async rtcToggleVideo() {
        if (!this.localStream) return;
        if (this.rtcVideoOff) {
            try {
                const s = await navigator.mediaDevices.getUserMedia({ video: true });
                const track = s.getVideoTracks()[0];
                const old = this.localStream.getVideoTracks()[0];
                this.localStream.removeTrack(old); this.localStream.addTrack(track);
                Object.values(this.simplePeers).forEach(p => p.replaceTrack(old, track, this.localStream));
                this.rtcVideoOff = false; this.updatePresence();
            } catch(e) { this.showToast("Camera failed.", true); }
        } else {
            const track = this.localStream.getVideoTracks()[0];
            track.stop();
            const dummy = document.createElement('canvas').captureStream().getVideoTracks()[0];
            this.localStream.removeTrack(track); this.localStream.addTrack(dummy);
            Object.values(this.simplePeers).forEach(p => p.replaceTrack(track, dummy, this.localStream));
            this.rtcVideoOff = true; this.updatePresence();
        }
    },

    async rtcToggleScreenShare() {
        if (!this.localStream) return;
        if (!this.isScreenSharing) {
            try {
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                Object.values(this.simplePeers).forEach(p => p.addStream(this.screenStream));
                this.isScreenSharing = true; this.updatePresence();
                this.screenStream.getVideoTracks()[0].onended = () => this.stopScreenShare();
            } catch(e) { this.showToast("Cancelled."); }
        } else this.stopScreenShare();
    },
    
    stopScreenShare() {
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(t => t.stop());
            Object.values(this.simplePeers).forEach(p => { try { p.removeStream(this.screenStream); } catch(e){} });
            this.screenStream = null;
        }
        this.isScreenSharing = false; this.updatePresence();
        // Remove local screen preview from grid if it exists
        document.querySelectorAll('[id^="wrap_vid_local_screen"]').forEach(e => e.remove());
    },

    createPeer(uid, initiator) {
        const p = new SimplePeer({ initiator, trickle: true, stream: this.localStream });
        if(this.isScreenSharing && this.screenStream) p.addStream(this.screenStream);
        p.on('signal', data => addDoc(collection(this.db, `${this.publicDataPath}/signaling`), { to: uid, from: this.logicalUid, room: this.inVoiceRoom, signal: JSON.stringify(data) }));
        p.on('stream', stream => this.addRemoteVideo(uid, stream));
        p.on('close', () => this.removePeer(uid));
        this.simplePeers[uid] = p;
    },

    addRemoteVideo(uid, stream) {
        const id = `vid_${uid}_${stream.id}`;
        if (document.getElementById(id)) return;
        const user = this.getUser(uid);
        const grid = document.getElementById('fullscreen-video-grid');
        const wrapper = document.createElement('div');
        wrapper.id = `wrap_${id}`; wrapper.className = "video-wrapper group";
        wrapper.onclick = () => this.toggleFullscreenVideo(id);
        
        // Avatar Fallback
        const fallback = document.createElement('div');
        fallback.className = "absolute inset-0 flex items-center justify-center transition-opacity duration-300";
        fallback.style.backgroundColor = this.getAvatarColor(user.avatar);
        const img = document.createElement('img');
        img.src = user.avatar;
        img.className = "w-32 h-32 rounded-full object-cover shadow-2xl bg-[#1e1f22]";
        fallback.appendChild(img);

        const v = document.createElement('video');
        v.id = id; v.autoplay = true; v.playsInline = true; v.srcObject = stream;
        v.className = "w-full h-full bg-black object-contain";
        v.onplaying = () => { fallback.style.opacity = '0'; };

        const label = document.createElement('div');
        label.className = "absolute bottom-3 left-3 bg-black/60 px-2.5 py-1.5 rounded text-[13px] text-white font-bold backdrop-blur-sm z-10";
        label.innerText = user.displayName + (stream.getAudioTracks().length === 0 ? " (Screen)" : "");

        wrapper.appendChild(fallback);
        wrapper.appendChild(v); 
        wrapper.appendChild(label);
        grid.appendChild(wrapper);
    },

    removePeer(uid) {
        if (this.simplePeers[uid]) { this.simplePeers[uid].destroy(); delete this.simplePeers[uid]; }
        document.querySelectorAll(`[id^="wrap_vid_${uid}"]`).forEach(e => e.remove());
        if(this.fullscreenVideoId && this.fullscreenVideoId.startsWith(`vid_${uid}`)) this.fullscreenVideoId = null;
    },

    handleIncomingSignal(from, sig) {
        if (this.simplePeers[from]) this.simplePeers[from].signal(JSON.parse(sig));
    },

    toggleFullscreenVideo(id) {
        this.fullscreenVideoId = this.fullscreenVideoId === id ? null : id;
    }

});

Alpine.data('nexusApp', window.nexusApp);
Alpine.start();
