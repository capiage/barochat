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

window.nexusApp = () => ({
    supabase: null,
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

    heartbeatInterval: null,

    async init() {
        try {
            this.supabase = createClient(supabaseUrl, supabaseKey, {
                global: { fetch: customFetch }
            });

            console.log("Supabase initialized inside init:", !!this.supabase);

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

    async startGlobalListeners() {
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
                this.supabase.channel(\`public:users:me:\${this.logicalUid}\`).on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: \`uid=eq.\${this.logicalUid}\` }, payload => {
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

    cacheUser(u) { if(u && u.uid) this.users[u.uid] = u; },
    getUser(uid) { return this.users[uid] || { uid, username: 'Unknown', displayName: 'Unknown', avatar: SVGS.C }; },

    triggerNotification(data) {
        const sender = this.getUser(data.senderId);
        const title = this.activeView === 'server' ? \`#\${this.getChannelName(data.roomId)}\` : \`@\${sender.displayName}\`;
        new Notification("New Message", { body: \`\${sender.displayName}: \${data.text}\`, icon: sender.avatar });
        this.showToast(\`\${title}: \${msg.text.substring(0, 30)}...\`);
    },

    getChannelName(cid) {
        for (const s of this.servers) {
            const ch = s.channels?.find(c => c.id === cid);
            if (ch) return ch.name;
        }
        const server = this.servers.find(s => s.id === cid);
        if (server) return server.name;
        return 'unknown-channel';
    },

    getServerMembers(status) {
        if(!this.activeTarget || this.activeView !== 'server') return [];
        const s = this.getServer(); if(!s) return [];
        const members = Object.values(this.users).filter(u => u.joinedServers?.includes(this.activeTarget));
        if (status === 'all') return members;
        return members.filter(u => this.isOnline(u.uid) === (status === 'online'));
    },
    isOnline(uid) { return this.globalPresence.some(p => p.uid === uid && p.status === 'online'); },
    getServer() { return this.servers.find(srv => srv.id === (this.activeTarget)); },

    openHome() { this.activeView = 'home'; this.activeTarget = null; this.activeChannelId = null; this.updatePresence(); },
    openServer(id) {
        this.activeView = 'server'; this.activeTarget = id;
        const s = this.servers.find(server => server.id === id);
        if (s && s.channels?.length > 0) this.activeChannelId = s.channels[0].id;
        this.updatePresence();
    },
    openDiscovery() { this.activeView = 'discovery'; this.activeTarget = null; },
    openDM(uid) {
        let dm = this.dms.find(d => d.partnerUid === uid);
        const id = dm ? dm.id : [this.logicalUid, uid].sort().join('_');
        if (!dm) {
            dm = { id, partnerUid: uid };
            this.dms.push(dm);
            this.supabase.from('dms').select('*').eq('id', id).maybeSingle().then(({data}) => {
                if(!data) this.supabase.from('dms').insert([{ id, participants: [this.logicalUid, uid].sort() }]);
            });
        }
        this.activeView = 'home'; this.activeTarget = id;
        this.updatePresence();
    },

    getDmPartner(id) {
        const dm = this.dms.find(d => d.id === id);
        return dm ? dm.partnerUid : null;
    },

    async sendMessage() {
        if (!this.newMessage.trim() && !this.pendingImage) return;
        const p = {
            roomId: this.currentChatId, senderId: this.logicalUid,
            text: this.newMessage.trim(), timestamp: Date.now(),
            image: this.pendingImage, edited: false
        };

        if (this.editingMessageId) {
            await this.supabase.from('messages').update({ text: this.newMessage.trim(), edited: true }).eq('id', this.editingMessageId);
            this.editingMessageId = null;
        } else {
            await this.supabase.from('messages').insert([p]);
        }
        this.newMessage = ''; this.pendingImage = null; this.showMentions = false;
    },

    async deleteMessage(id) { await this.supabase.from('messages').delete().eq('id', id); },
    
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
    },
    async removeFriend(uid) {
        const friends = (this.currentUserProfile.friends || []).filter(id => id !== uid);
        await this.supabase.from('users').update({ friends }).eq('uid', this.logicalUid);
    },

    async createServer() {
        const sid = 'srv_' + Math.random().toString(36).substr(2, 9);
        await this.supabase.from('servers').insert([{ id: sid,
            name: this.newServerName.trim(), icon: null, owner: this.logicalUid, isPublic: false, banner: null, bannerColor: '#5865F2', bio: "A new community.",
            channels: [{ id: 'c_general', name: 'general', type: 'text' }]
        }]);
        const joined = [...(this.currentUserProfile.joinedServers || []), sid];
        await this.supabase.from('users').update({ joinedServers: joined }).eq('uid', this.logicalUid);
        this.showCreateServerModal = false; this.openServer(sid);
    },

    async joinServer(id) {
        const joined = [...new Set([...(this.currentUserProfile.joinedServers || []), id])];
        await this.supabase.from('users').update({ joinedServers: joined }).eq('uid', this.logicalUid);
        this.openServer(id);
    },

    openSettings() { this.editProfile = JSON.parse(JSON.stringify(this.currentUserProfile)); this.showSettingsModal = true; },
    async saveProfileSettings() {
        try {
            await this.supabase.from('users').update({
                displayName: this.editProfile.displayName,
                bio: this.editProfile.bio,
                avatar: this.editProfile.avatar
            }).eq('uid', this.logicalUid);
            this.showSettingsModal = false;
            this.showToast("Profile updated!");
        } catch (e) { this.showToast("Failed to save profile.", true); }
    },

    openServerSettingsModal(tab = 'overview') {
        const s = this.getServer(); if(!s) return;
        this.editServer = JSON.parse(JSON.stringify(s));
        if(!this.editServer.channels) this.editServer.channels = [];
        this.serverSettingsTab = tab; this.showServerSettingsModal = true;
    },
    async saveServerSettings() {
        try {
            const updateData = {};
            if (this.editServer.name !== undefined) updateData.name = this.editServer.name;
            if (this.editServer.isPublic !== undefined) updateData.isPublic = this.editServer.isPublic;
            if (this.editServer.channels !== undefined) updateData.channels = this.editServer.channels;
            if (this.editServer.bannerColor !== undefined) updateData.bannerColor = this.editServer.bannerColor;
            if (this.editServer.bio !== undefined) updateData.bio = this.editServer.bio;
            
            await this.supabase.from('servers').update(updateData).eq('id', this.editServer.id);
            this.showServerSettingsModal = false;
            this.showToast("Server updated.");
        } catch (e) { this.showToast("Failed to save server settings.", true); }
    },

    openProfilePopout(uid) { this.popoutUser = this.getUser(uid); this.showProfilePopout = !!this.popoutUser; },
    showToast(msg, isError = false) {
        this.toast.message = msg; this.toast.isError = isError; this.toast.show = true;
        if(this.toast.timeout) clearTimeout(this.toast.timeout);
        this.toast.timeout = setTimeout(() => { this.toast.show = false; }, 4000);
    },

    updatePresence() {
        if(!this.logicalUid) return;
        this.supabase.from('presence').upsert([{ uid: this.logicalUid, 
            status: 'online', currentVoice: this.inVoiceRoom,
            isScreenSharing: this.isScreenSharing, isCameraOff: this.rtcVideoOff, isMuted: this.isMuted,
            lastActive: Date.now()
         }]);
    },

    async deleteServer() {
        const sid = this.editServer.id;
        await this.supabase.from('servers').delete().eq('id', sid);
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
        const id = \`vid_\${uid}_\${stream.id}\`;
        if (document.getElementById(id)) return;
        const user = this.getUser(uid);
        const grid = document.getElementById('fullscreen-video-grid');
        const wrapper = document.createElement('div');
        wrapper.id = \`wrap_\${id}\`; wrapper.className = "video-wrapper group";
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
        document.querySelectorAll(\`[id^="wrap_vid_\${uid}"]\`).forEach(e => e.remove());
        if(this.fullscreenVideoId && this.fullscreenVideoId.startsWith(\`vid_\${uid}\`)) this.fullscreenVideoId = null;
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