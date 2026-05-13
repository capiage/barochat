import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/module.esm.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SVGS, FAVICONS } from './constants.js';

const supabaseUrl = 'https://tzdwxrdkqcntskwdvkfl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6ZHd4cmRrcWNudHNrd2R2a2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2ODUzNjksImV4cCI6MjA5NDI2MTM2OX0.MpMEqeXXgAGuOwu9fCgSYMmWsP4JHze2s2DerNrUBu4';

// BRUTE FORCE: Intercept every fetch call and manually inject headers
const customFetch = async (url, options = {}) => {
  const headers = new Headers(options.headers || {});
  headers.set('apikey', supabaseKey);
  headers.set('Authorization', `Bearer ${supabaseKey}`);
  return fetch(url, { ...options, headers });
};

const supabase = createClient(supabaseUrl, supabaseKey, {
  global: { fetch: customFetch }
});

window.nexusApp = () => ({
    supabase,
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
    showCallOverlay: false, incomingCall: null,
    showMobileSidebar: false,
    
    // Navigation & UI
    activeView: 'home', 
    activeTarget: null, 
    activeChannelId: null, 
    showMembersList: true,
    viewingVoice: false,
    friendsTab: 'online', directFriendRequestUsername: '', fullscreenVideoId: null,
    
    // Message Input
    newMessage: '', pendingImage: null, editingMessageId: null,
    showMentions: false, mentionQuery: '', filteredMentionUsers: [], mentionIndex: 0,
    sidebarSearch: '',
    
    // Data
    servers: [], dms: [], messages: [], filteredMessages: [], users: {}, globalPresence: [],
    
    get myServers() { return this.servers.filter(s => this.currentUserProfile?.joinedServers?.includes(s.id)); },
    get discoveryServers() { return this.servers.filter(s => s.isPublic && !this.currentUserProfile?.joinedServers?.includes(s.id)); },
    get currentChatId() { return this.activeView === 'server' ? this.activeChannelId : this.activeTarget; },
    
    // Friend Logic
    get filteredFriends() {
        const myFriends = this.currentUserProfile?.friends || [];
        const list = Object.values(this.users).filter(u => myFriends.includes(u.uid) && u.friends?.includes(this.logicalUid));
        if (!this.sidebarSearch.trim()) return list;
        const q = this.sidebarSearch.toLowerCase();
        return list.filter(u => u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q));
    },
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
        let count = 0;
        this.dms.forEach(dm => {
            if (this.hasUnread(dm.id) && this.activeTarget !== dm.id) {
                const msgs = this.messages.filter(m => m.roomId === dm.id);
                if (msgs.length > 0) {
                    const lastRead = this.currentUserProfile?.lastRead?.[dm.id] || 0;
                    count += msgs.filter(m => m.senderId !== this.logicalUid && m.timestamp > lastRead).length;
                }
            }
        });
        return count;
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
        this.supabase.from('users').update({ lastRead: lr }).eq('uid', this.logicalUid);
        this.updateFavicon();
    },
    updateFavicon() {
        const link = document.getElementById('dynamic-favicon');
        if (link) {
            link.href = FAVICONS.NORMAL;
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

        // URL detection and embedding
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        safe = safe.replace(urlRegex, (url) => {
            const cleanUrl = url.replace(/[.,!?;:]+$/, '');
            const suffix = url.slice(cleanUrl.length);
            
            if (cleanUrl.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i)) {
                return `<a href="${cleanUrl}" target="_blank" class="text-[#00A8FC] hover:underline">${cleanUrl}</a>${suffix}<div class="mt-2"><img src="${cleanUrl}" class="max-w-md w-full rounded-md cursor-pointer block" onclick="window.nexusAction('openImage', '${cleanUrl}')"></div>`;
            }
            const ytMatch = cleanUrl.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(.+)/);
            if (ytMatch && ytMatch[1]) {
                const vid = ytMatch[1].split(/[?&]/)[0];
                return `<a href="${cleanUrl}" target="_blank" class="text-[#00A8FC] hover:underline">${cleanUrl}</a>${suffix}<div class="mt-2 aspect-video w-full max-w-md"><iframe class="w-full h-full rounded-md" src="https://www.youtube.com/embed/${vid}" frameborder="0" allowfullscreen></iframe></div>`;
            }
            return `<a href="${cleanUrl}" target="_blank" class="text-[#00A8FC] hover:underline">${cleanUrl}</a>${suffix}`;
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

    avatarColors: {},
    getAvatarColor(avatar) {
        if (!avatar) return '#5865F2';
        if (this.avatarColors[avatar]) return this.avatarColors[avatar];
        if (avatar.startsWith('data:image/svg+xml')) {
            const match = avatar.match(/fill=['"]%23([a-fA-F0-9]{6})['"]/);
            if (match) {
                this.avatarColors[avatar] = '#' + match[1];
                return '#' + match[1];
            }
            return '#5865F2';
        }
        
        this.avatarColors[avatar] = '#1e1f22'; // fallback while loading
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 50; canvas.height = 50;
            ctx.drawImage(img, 0, 0, 50, 50);
            try {
                const data = ctx.getImageData(0, 0, 50, 50).data;
                let maxCount = 0;
                let prominent = [30, 31, 34];
                const counts = {};
                for (let i = 0; i < data.length; i += 16) { // step by 16 for performance
                    const r = Math.round(data[i] / 32) * 32;
                    const g = Math.round(data[i+1] / 32) * 32;
                    const b = Math.round(data[i+2] / 32) * 32;
                    if (r < 40 && g < 40 && b < 40) continue; // ignore dark colors
                    if (r > 230 && g > 230 && b > 230) continue; // ignore white
                    const key = `${r},${g},${b}`;
                    counts[key] = (counts[key] || 0) + 1;
                    if (counts[key] > maxCount) {
                        maxCount = counts[key];
                        prominent = [data[i], data[i+1], data[i+2]];
                    }
                }
                this.avatarColors[avatar] = `rgb(${prominent[0]},${prominent[1]},${prominent[2]})`;
            } catch(e) {}
        };
        img.src = avatar;

        return this.avatarColors[avatar];
    },

    // WebRTC State
    inVoiceRoom: null, voicePeers: {}, 
    rtcVideoOff: true, isMuted: false, isDeafened: false, isScreenSharing: false,
    localStream: null, screenStream: null, simplePeers: {},

    supabase: null, heartbeatInterval: null,

    async init() {
        try {
            console.log("Supabase initialized globally:", !!this.supabase);

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
                if(this.logicalUid) this.supabase.from('presence').upsert([{ uid: this.logicalUid,  status: 'offline'  }]);
            });

            const joinId = new URLSearchParams(window.location.search).get('join');
            if (joinId) {
                window.history.replaceState({}, document.title, window.location.pathname);
                this._pendingJoinId = joinId;
            }

            // Request Notification Permission
            if (Notification.permission === 'default') Notification.requestPermission();
        } catch(e) {
            console.error("Init Error:", e);
            this.showToast("Connection failed.", true);
        }
    },

    async processAuth() {
        if (this.authMode === 'login' && (!this.authUsername || !this.authPassword)) return;
        if (this.authMode === 'register' && (!this.authUsername || !this.authPassword || !this.authDisplayName)) return;
        this.authLoading = true;
        const username = this.authUsername.toLowerCase().trim();
        try {
            if (this.authMode === 'login') {
                const { data, error } = await this.supabase.from('accounts').select('*').eq('username', username).eq('password', this.authPassword).single();
                if (error || !data) throw new Error("Invalid credentials.");
                this.logicalUid = data.profileId;
                localStorage.setItem('lebarochat_session_v4', this.logicalUid);

                // Ensure user profile exists
                const { data: profile } = await this.supabase.from('users').select('*').eq('uid', this.logicalUid).maybeSingle();
                if (!profile) {
                    await this.supabase.from('users').insert([{
                        uid: this.logicalUid, username, displayName: username,
                        avatar: null, bio: "Ready to chat!", banner: null,
                        joinedServers: [], friends: [], lastRead: {}
                    }]);
                }

                await this.loadLogicalProfile();
            } else {
                const { data: existing } = await this.supabase.from('accounts').select('*').eq('username', username).single();
                if(existing) throw new Error("Username taken.");

                const pid = "user_" + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
                await this.supabase.from('accounts').insert([{ profileId: pid, username, password: this.authPassword }]);
                
                const profile = {
                    uid: pid, username, displayName: this.authDisplayName.trim() || username,
                    avatar: this.authAvatar, bio: "Ready to chat!", banner: null,
                    joinedServers: [], friends: [], lastRead: {}
                };
                await this.supabase.from('users').insert([profile]);
                this.logicalUid = pid;
                localStorage.setItem('lebarochat_session_v4', pid);
                await this.loadLogicalProfile();
            }
        } catch(e) { this.showToast(e.message, true); this.authLoading = false; }
    },

    async loadLogicalProfile() {
        if(!this.logicalUid) return;
        const { data } = await this.supabase.from('users').select('*').eq('uid', this.logicalUid).maybeSingle();
        if (data) {
            this.currentUserProfile = data;
            this.cacheUser(this.currentUserProfile);
            if(!this.isReady) {
                this.supabase.channel(`public:users:me:${this.logicalUid}`).on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `uid=eq.${this.logicalUid}` }, payload => {
                    if (payload.new) {
                        this.currentUserProfile = payload.new;
                        this.cacheUser(this.currentUserProfile);
                    }
                }).subscribe();
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
    },

    startGlobalListeners() {
        const fetchInitial = async () => {
            const { data: u } = await this.supabase.from('users').select('*');
            if (u) u.forEach(d => this.cacheUser(d));
            const { data: s } = await this.supabase.from('servers').select('*');
            if (s) this.servers = s;
            const { data: dms } = await this.supabase.from('dms').select('*');
            if (dms) {
                const ds = [];
                dms.forEach(d => {
                    if (d.participants?.includes(this.logicalUid)) {
                        const partnerUid = d.participants.find(p => p !== this.logicalUid) || this.logicalUid;
                        ds.push({ id: d.id, partnerUid });
                    }
                });
                this.dms = ds;
            }
            const { data: p } = await this.supabase.from('presence').select('*');
            if (p) this.globalPresence = p;
            const { data: m } = await this.supabase.from('messages').select('*').order('timestamp', { ascending: true });
            if (m) { this.messages = m; this.filterMessages(); }
        };
        fetchInitial();

        this.supabase.channel('public:users').on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, payload => {
            if (payload.new) this.cacheUser(payload.new);
        }).subscribe();

        this.supabase.channel('public:servers').on('postgres_changes', { event: '*', schema: 'public', table: 'servers' }, payload => {
            if (payload.eventType === 'DELETE') this.servers = this.servers.filter(s => s.id !== payload.old.id);
            else {
                const i = this.servers.findIndex(s => s.id === payload.new.id);
                if (i >= 0) this.servers[i] = payload.new; else this.servers.push(payload.new);
            }
        }).subscribe();

        this.supabase.channel('public:dms').on('postgres_changes', { event: '*', schema: 'public', table: 'dms' }, payload => {
            if (payload.new && payload.new.participants?.includes(this.logicalUid)) {
                const partnerUid = payload.new.participants.find(p => p !== this.logicalUid) || this.logicalUid;
                const d = { id: payload.new.id, partnerUid };
                if (!this.dms.find(x => x.id === d.id)) this.dms.push(d);
            }
        }).subscribe();

        this.supabase.channel('public:messages').on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, payload => {
            if (payload.eventType === 'INSERT') {
                const data = payload.new;
                this.messages.push(data);
                this.messages.sort((a, b) => a.timestamp - b.timestamp);
                this.filterMessages();
                if (data.senderId !== this.logicalUid && (this.isMentioned(data.text) || (data.roomId.includes('_') && this.dms.some(d => d.id === data.roomId)))) {
                    this.triggerNotification(data);
                }
            } else if (payload.eventType === 'UPDATE') {
                const i = this.messages.findIndex(m => m.id === payload.new.id);
                if (i >= 0) this.messages[i] = payload.new;
                this.filterMessages();
            } else if (payload.eventType === 'DELETE') {
                this.messages = this.messages.filter(m => m.id !== payload.old.id);
                this.filterMessages();
            }
        }).subscribe();

        this.supabase.channel('public:presence').on('postgres_changes', { event: '*', schema: 'public', table: 'presence' }, payload => {
            if (payload.eventType === 'DELETE') {
                this.globalPresence = this.globalPresence.filter(p => p.uid !== payload.old.uid);
            } else {
                const i = this.globalPresence.findIndex(p => p.uid === payload.new.uid);
                if (i >= 0) this.globalPresence[i] = payload.new; else this.globalPresence.push(payload.new);
                
                const data = payload.new;
                const now = Date.now();
                if (now - data.lastActive < 60000 && data.status === 'online') {
                    if (this.inVoiceRoom && data.currentVoice === this.inVoiceRoom && data.uid !== this.logicalUid && !this.simplePeers[data.uid]) {
                        this.createPeer(data.uid, this.logicalUid < data.uid);
                    }
                }
            }
            if(this.inVoiceRoom) {
                const current = this.globalPresence.filter(p => p.currentVoice === this.inVoiceRoom).map(p => p.uid);
                Object.keys(this.simplePeers).forEach(uid => { if (!current.includes(uid)) this.removePeer(uid); });
            }
        }).subscribe();

        this.supabase.channel('public:signaling').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'signaling', filter: `to=eq.${this.logicalUid}` }, async payload => {
            const data = payload.new;
            if (data.type === 'call-invite' && data.room === 'global') {
                this.incomingCall = { from: data.from, room: data.callRoom };
                this.showCallOverlay = true;
                this._callTimeout = setTimeout(() => this.declineCall(), 30000);
            } else if (data.type === 'call-response' && data.room === 'global') {
                if (data.response === 'accepted') {
                    this.joinVoiceRoom(data.callRoom);
                } else {
                    this.showToast("Call declined.");
                }
            } else if (data.room === this.inVoiceRoom) {
                this.handleIncomingSignal(data.from, data.signal);
            }
            await this.supabase.from('signaling').delete().eq('id', data.id);
        }).subscribe();
    },

    async startCall(uid) {
        const callRoom = 'call_' + Math.random().toString(36).substr(2, 9);
        await this.supabase.from('signaling').insert([{
            to: uid, from: this.logicalUid, type: 'call-invite', room: 'global', callRoom
        }]);
        this.showToast("Calling...");
        // If we don't get a response, we might need a timeout
    },
    async acceptCall() {
        if (!this.incomingCall) return;
        clearTimeout(this._callTimeout);
        const { from, room } = this.incomingCall;
        await this.supabase.from('signaling').insert([{
            to: from, from: this.logicalUid, type: 'call-response', room: 'global', response: 'accepted', callRoom: room
        }]);
        this.showCallOverlay = false;
        this.joinVoiceRoom(room);
        this.incomingCall = null;
    },
    async declineCall() {
        if (!this.incomingCall) return;
        clearTimeout(this._callTimeout);
        const { from, room } = this.incomingCall;
        await this.supabase.from('signaling').insert([{
            to: from, from: this.logicalUid, type: 'call-response', room: 'global', response: 'declined', callRoom: room
        }]);
        this.showCallOverlay = false;
        this.incomingCall = null;
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
        this.supabase.from('presence').upsert([{ uid: this.logicalUid, 
            uid: this.logicalUid, status: 'online', currentVoice: this.inVoiceRoom,
            isScreenSharing: this.isScreenSharing, isCameraOff: this.rtcVideoOff, isMuted: this.isMuted,
            lastActive: Date.now()
         }]);
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
        // Check for channel in any server
        for (const s of this.servers) {
            const c = s.channels?.find(ch => ch.id === cid);
            if (c) return c.name;
        }
        // Check for DM
        const partner = this.getDmPartner(cid);
        if (partner) return this.getUser(partner)?.displayName || 'DM';

        // Check for Server Name
        const server = this.servers.find(s => s.id === cid);
        if (server) return server.name;

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
    getMemberData(uid, sid) {
        const s = this.servers.find(srv => srv.id === (sid || this.activeTarget));
        return s?.memberData?.[uid] || { joinedAt: 0, roles: [] };
    },
    getMemberRoles(uid, sid) {
        const s = this.servers.find(srv => srv.id === (sid || this.activeTarget));
        if (!s || !s.memberData?.[uid]) return [];
        return (s.roles || []).filter(r => s.memberData[uid].roles.includes(r.id));
    },

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

    getDmPartner(dmId) { 
        if (!dmId) return null;
        const d = this.dms.find(d => d.id === dmId);
        if (d) return d.partnerUid;
        if (dmId.includes('_') && !dmId.startsWith('c')) {
            const parts = dmId.split('_');
            if (parts.length === 2) return parts.find(p => p !== this.logicalUid);
        }
        return null;
    },
    openVoiceGrid() {
        if (!this.inVoiceRoom) return;
        let serverId = null;
        for (const s of this.servers) {
            if (s.channels && s.channels.some(c => c.id === this.inVoiceRoom)) {
                serverId = s.id;
                break;
            }
        }
        if (serverId) {
            this.activeView = 'server';
            this.activeTarget = serverId;
        }
        this.viewingVoice = true;
    },

    openDM(id) { this.activeView = 'home'; this.activeTarget = id; this.activeChannelId = null; this.viewingVoice = (this.inVoiceRoom === id); this.markRead(id); },
    async initiateDM(uid) {
        const id = [this.logicalUid, uid].sort().join('_');
        if (!this.dms.some(d => d.id === id)) await this.supabase.from('dms').insert([{ id, participants: [this.logicalUid, uid].sort() }]);
        this.showProfilePopout = false; this.openDM(id);
    },
    
    handleVoiceChannelClick(id) {
        if (this.inVoiceRoom === id) this.leaveVoiceRoom();
        else this.joinVoiceRoom(id);
    },
    formatTime(ts) {
        if (!ts) return '';
        const d = new Date(ts), now = new Date(), diff = now - d;
        if (diff < 86400000 && d.getDate() === now.getDate()) return `Today at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        if (diff < 172800000 && new Date(now - 86400000).getDate() === d.getDate()) return `Yesterday at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },
    async deleteMessage(id) { await this.supabase.from('messages').delete().eq('id', id); },
    copyInviteLink() {
        const url = window.location.origin + window.location.pathname + '?join=' + this.activeTarget;
        this.copyToClipboard(url);
    },
    async leaveServer() {
        const joined = (this.currentUserProfile.joinedServers || []).filter(id => id !== this.activeTarget);
        await this.supabase.from('users').update({ joinedServers: joined }).eq('uid', this.logicalUid);
        this.openHome();
    },
    toggleMute() {
        this.isMuted = !this.isMuted;
        if (this.localStream) this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMuted);
        this.updatePresence();
    },
    toggleDeafen() {
        this.isDeafened = !this.isDeafened;
        if (this.isDeafened) { this.isMuted = true; if (this.localStream) this.localStream.getAudioTracks().forEach(t => t.enabled = false); }
        this.updatePresence();
    },
    logout() { localStorage.removeItem('lebarochat_session_v4'); window.location.reload(); },
    async addChannel() {
        if (!this.newChannelName.trim()) return;
        const s = this.getServer();
        const chs = [...(s.channels || []), { id: 'c_' + Date.now(), name: this.newChannelName.trim(), type: this.newChannelType }];
        await this.supabase.from('servers').update({ channels: chs }).eq('id', s.id);
        this.newChannelName = ''; this.editServer.channels = chs;
    },
    async removeChannel(id) {
        const s = this.getServer();
        const chs = s.channels.filter(c => c.id !== id);
        await this.supabase.from('servers').update({ channels: chs }).eq('id', s.id);
        this.editServer.channels = chs;
    },

    isFriend(uid) { return this.currentUserProfile?.friends?.includes(uid) && this.getUser(uid)?.friends?.includes(this.logicalUid); },
    isPendingOutgoing(uid) { return this.currentUserProfile?.friends?.includes(uid) && !this.getUser(uid)?.friends?.includes(this.logicalUid); },
    isPendingIncoming(uid) { return !this.currentUserProfile?.friends?.includes(uid) && this.getUser(uid)?.friends?.includes(this.logicalUid); },
    
    async addFriend(uid) {
        const friends = [...(this.currentUserProfile.friends || []), uid];
        await this.supabase.from('users').update({ friends }).eq('uid', this.logicalUid);
        this.showToast("Request processed.");
    },
    async removeFriend(uid) {
        const friends = (this.currentUserProfile.friends || []).filter(id => id !== uid);
        await this.supabase.from('users').update({ friends }).eq('uid', this.logicalUid);
    },
    
    sendDirectFriendRequest() {
        const name = this.directFriendRequestUsername.replace('@', '').toLowerCase();
        const u = Object.values(this.users).find(u => u.username === name);
        if (u) { this.addFriend(u.uid); this.directFriendRequestUsername = ''; }
        else this.showToast("User not found.", true);
    },

    openProfilePopout(uid) { this.popoutUser = this.getUser(uid); this.showProfilePopout = !!this.popoutUser; },

    getChatPlaceholder() {
        if (this.activeView === 'home' && this.activeTarget) return `Message @${this.getUser(this.getDmPartner(this.activeTarget))?.username}`;
        return `Message #${this.getChannelName(this.activeChannelId)}`;
    },

    async sendMessage() {
        if (!this.currentChatId || (!this.newMessage.trim() && !this.pendingImage)) return;
        if (this.editingMessageId) {
            await this.supabase.from('messages').update({ text: this.newMessage.trim(), edited: true }).eq('id', this.editingMessageId);
            this.editingMessageId = null; this.newMessage = '';
        } else {
            const imgUrl = await this.uploadImage(this.pendingImage);
            const p = { roomId: this.currentChatId, senderId: this.logicalUid, text: this.newMessage.trim(), image: imgUrl, timestamp: Date.now() };
            this.newMessage = ''; this.pendingImage = null; this.showMentions = false;
            await this.supabase.from('messages').insert([p]);
            this.markRead(this.currentChatId); 
        }
    },

    async createServer() {
        const iconUrl = await this.uploadImage(this.newServerIcon);
        const sid = 'srv_' + Math.random().toString(36).substr(2, 9);
        const now = Date.now();
        await this.supabase.from('servers').insert([{ id: sid, 
            name: this.newServerName.trim(), icon: iconUrl, owner: this.logicalUid, isPublic: false, banner: null, bannerColor: '#5865F2', bio: "A new community.",
            channels: [{ id: 'c1_' + now, name: 'general', type: 'text' }, { id: 'c2_' + now, name: 'Voice', type: 'voice' }],
            roles: [{ id: 'admin', name: 'Admin', color: '#ED4245' }, { id: 'mod', name: 'Moderator', color: '#5865F2' }],
            memberData: { [this.logicalUid]: { joinedAt: now, roles: ['admin'] } }
         }]);
        const joined = [...(this.currentUserProfile.joinedServers || []), sid];
        await this.supabase.from('users').update({ joinedServers: joined }).eq('uid', this.logicalUid);
        this.showCreateServerModal = false; this.openServer(sid);
    },

    async joinServer(id) {
        const joined = [...new Set([...(this.currentUserProfile.joinedServers || []), id])];
        await this.supabase.from('users').update({ joinedServers: joined }).eq('uid', this.logicalUid);
        
        // Update server member data
        const { data } = await this.supabase.from('servers').select('*').eq('id', id).single();
        if (data) {
            const memberData = data.memberData || {};
            if (!memberData[this.logicalUid]) {
                memberData[this.logicalUid] = { joinedAt: Date.now(), roles: [] };
                await this.supabase.from('servers').update({ memberData }).eq('id', id);
            }
        }
        this.openServer(id);
    },

    openSettings() { this.editProfile = JSON.parse(JSON.stringify(this.currentUserProfile)); this.showSettingsModal = true; },
    async saveProfileSettings() {
        try {
            const avatarUrl = await this.uploadImage(this.editProfile.avatar);
            const bannerUrl = await this.uploadImage(this.editProfile.banner);
            await this.supabase.from('users').update({ 
                displayName: this.editProfile.displayName, 
                bio: this.editProfile.bio, 
                avatar: avatarUrl, 
                banner: bannerUrl 
            }).eq('uid', this.logicalUid);
            this.showSettingsModal = false;
            this.showToast("Profile updated!");
        } catch (e) {
            console.error("Save Profile Error:", e);
            this.showToast("Failed to save profile.", true);
        }
    },

    openServerSettingsModal(tab = 'overview') {
        const s = this.getServer(); if(!s) return;
        this.editServer = JSON.parse(JSON.stringify(s)); 
        if(!this.editServer.channels) this.editServer.channels = [];
        this.serverSettingsTab = tab; this.showServerSettingsModal = true;
    },

    async saveServerSettings() {
        try {
            const iconUrl = await this.uploadImage(this.editServer.icon);
            const bannerUrl = await this.uploadImage(this.editServer.banner);
            
            const updateData = {};
            if (this.editServer.name !== undefined) updateData.name = this.editServer.name;
            if (this.editServer.isPublic !== undefined) updateData.isPublic = this.editServer.isPublic;
            if (this.editServer.channels !== undefined) updateData.channels = this.editServer.channels;
            if (this.editServer.bannerColor !== undefined) updateData.bannerColor = this.editServer.bannerColor;
            if (this.editServer.bio !== undefined) updateData.bio = this.editServer.bio;
            if (iconUrl !== undefined) updateData.icon = iconUrl;
            if (bannerUrl !== undefined) updateData.banner = bannerUrl;

            await this.supabase.from('servers').update(updateData).eq('id', this.editServer.id);
            this.showServerSettingsModal = false;
            this.showToast("Server updated.");
        } catch (e) {
            console.error("Save Server Error:", e);
            this.showToast("Failed to save server settings.", true);
        }
    },

    triggerImageUpload(context) {
        const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
        i.onchange = (e) => this.processImage(e.target.files[0], context); i.click();
    },
    async uploadImage(dataUrl) {
        if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
        try {
            const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}.jpg`;
            const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
            const binaryString = window.atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const { data, error } = await this.supabase.storage.from('uploads').upload(fileName, bytes.buffer, { contentType: 'image/jpeg' });
            if (error) throw error;
            const { data: publicUrlData } = this.supabase.storage.from('uploads').getPublicUrl(fileName);
            return publicUrlData.publicUrl;
        } catch (e) {
            console.error("Upload Error:", e);
            throw e;
        }
    },

    processImage(file, context) {
        if (!file) return; const r = new FileReader();
        r.onload = (e) => {
            const img = new Image();
            img.onload = async () => {
                const c = document.createElement('canvas');
                let mw = 256, mh = 256;
                if (context === 'chat') { mw = 1200; mh = 1200; }
                else if (context.includes('Banner')) { mw = 800; mh = 400; }
                let w = img.width, h = img.height;
                if (w > h) { if (w > mw) { h *= mw / w; w = mw; } } else { if (h > mh) { w *= mh / h; h = mh; } }
                c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
                const data = c.toDataURL('image/jpeg', 0.7);
                
                if (context === 'chat') this.pendingImage = data;
                else if (context === 'setup') this.authAvatar = data;
                else {
                    if (context === 'edit') this.editProfile.avatar = data;
                    else if (context === 'banner') this.editProfile.banner = data;
                    else if (context === 'server') this.newServerIcon = data;
                    else if (context === 'serverEdit') this.editServer.icon = data;
                    else if (context === 'serverBannerEdit') this.editServer.banner = data;
                }
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
            const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
            this.localStream = stream;
            
            // Dummy video for initial peer setup if camera is off
            const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
            const dummyVideo = canvas.captureStream().getVideoTracks()[0];
            this.localStream.addTrack(dummyVideo);

            this.isMuted = false;
            this.updatePresence();
            setTimeout(() => { 
                const lv = document.getElementById('local-video');
                if(lv) lv.srcObject = this.localStream; 
            }, 500);
        } catch(e) { 
            console.error("Join Voice Error:", e);
            this.showToast("Mic failed to start.", true); 
        }
    },

    leaveVoiceRoom() {
        if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
        if (this.screenStream) this.stopScreenShare();
        Object.values(this.simplePeers).forEach(p => p.destroy());
        this.simplePeers = {}; this.inVoiceRoom = null; this.localStream = null; this.viewingVoice = false;
        this.updatePresence();
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
            if (track) track.stop();
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
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" }, audio: true });
                Object.values(this.simplePeers).forEach(p => p.addStream(this.screenStream));
                this.isScreenSharing = true; this.updatePresence();
                this.screenStream.getVideoTracks()[0].onended = () => this.stopScreenShare();
                this.addRemoteVideo('local_screen', this.screenStream);
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
        document.querySelectorAll('[id^="wrap_vid_local_screen"]').forEach(e => e.remove());
    },

    async deleteServer() {
        if (!confirm("Are you sure you want to delete this server? This action cannot be undone.")) return;
        const sid = this.activeTarget;
        await this.supabase.from('servers').delete().eq('id', sid);
        // Remove from all users' joinedServers (expensive, but necessary for clean state)
        // In a real app, this would be a cloud function. For now, we'll just handle it for the current user.
        const joined = (this.currentUserProfile.joinedServers || []).filter(id => id !== sid);
        await this.supabase.from('users').update({ joinedServers: joined }).eq('uid', this.logicalUid);
        this.showServerSettingsModal = false;
        this.openHome();
    },

    createPeer(uid, initiator) {
        const p = new SimplePeer({ initiator, trickle: true, stream: this.localStream });
        if(this.isScreenSharing && this.screenStream) p.addStream(this.screenStream);
        p.on('signal', data => this.supabase.from('signaling').insert([{ to: uid, from: this.logicalUid, room: this.inVoiceRoom, signal: JSON.stringify(data) }]));
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
        wrapper.style.backgroundColor = this.getAvatarColor(user.avatar);
        wrapper.onclick = () => this.toggleFullscreenVideo(id);
        const fallback = document.createElement('div');
        fallback.className = "absolute inset-0 flex items-center justify-center transition-opacity duration-300";
        fallback.style.backgroundColor = this.getAvatarColor(user.avatar);
        const img = document.createElement('img');
        img.src = user.avatar;
        img.className = "w-32 h-32 rounded-full object-cover shadow-2xl bg-[#1e1f22]";
        fallback.appendChild(img);
        const v = document.createElement('video');
        v.id = id; v.autoplay = true; v.playsInline = true; v.srcObject = stream;
        v.className = "w-full h-full object-cover";
        v.onplaying = () => { fallback.style.opacity = '0'; };
        const label = document.createElement('div');
        label.className = "absolute bottom-3 left-3 bg-black/60 px-2.5 py-1.5 rounded text-[13px] text-white font-bold z-10";
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
