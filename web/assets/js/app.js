/**
 * AudioAgent App Logic
 */

// Configuration
const API_BASE = 'api.php';

// State
const state = {
    currentTab: 'projects', // Match index.html default active tab
    quickMerge: {
        directories: JSON.parse(localStorage.getItem('qm_directories') || '[]'),
        directoryErrors: {},
        linkedSummaries: JSON.parse(localStorage.getItem('linked_summaries') || '{}'),
        files: [],
        selectedFiles: [], // Changed from Set to Array to maintain selection order
        taskId: null,
        statusTimeout: null,
        isProcessing: false,
        currentPage: 0,
        editingFileIndex: null,
        expandedDocIndex: null,
        highlightPath: null
    },
    documents: {
        files: [],
        currentPage: 0,
        selectedFiles: [] // Placeholder if we need selection later
    },
    merge: {
        files: [],
        taskId: null,
        statusTimeout: null,
        isProcessing: false
    },
    user: JSON.parse(localStorage.getItem('auth_user') || 'null'),
    isRecording: false,
    meetingDetails: {}, // Keyed by file path
    projects: [], // Array of { id, name, createdAt, files: [] }
    projectActionTargetId: null, // ID of project currently being modified (for modals)
    activeFilePath: null, // Path of the file currently expanded for actions
    linkingDocPath: null, // Path of the document currently being linked
    simulatedMetadata: {} // Keyed by file path, stores simulated analysis results (linked docs, etc)
};

const GOOGLE_CLIENT_ID = '151953735639-dij5kkdgg0uroe8uqqioqu3s79bif6l5.apps.googleusercontent.com'; // Placeholder

// Initialization
document.addEventListener('DOMContentLoaded', async function () {
    console.log('AudioAgent initialized');

    // Load from safe UserData folder if in Mac App
    if (window.userDataPath) {
        await loadPersistentData();
    }

    // Report app identity and version to admin system (regardless of login)
    logActivity();

    initAuth();
    initTabs();
    initDragAndDrop();
    initFileUploads();
    initActions();
    initSearch(); // Initialize search input listener
});

function initSearch() {
    const searchInput = document.getElementById('global-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            window.handleSearchInput(e.target.value);
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                window.handleSearch(searchInput.value);
            }
        });
    }
}

window.handleSearchInput = function (value) {
    const clearBtn = document.getElementById('search-clear');
    if (clearBtn) {
        if (value && value.length > 0) {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
            // If query cleared manually, close search view
            if (document.getElementById('search-results-tab').classList.contains('active')) {
                window.closeSearch();
            }
        }
    }
};

async function loadPersistentData() {
    try {
        const response = await fetch(`${API_BASE}?action=persist_load`, {
            method: 'POST',
            body: JSON.stringify({ userDataPath: window.userDataPath })
        });
        const result = await response.json();
        if (result.success && result.data) {
            console.log('Loaded persistent configuration from UserData folder');
            if (result.data.qm_directories) state.quickMerge.directories = result.data.qm_directories;
            if (result.data.linked_summaries) state.quickMerge.linkedSummaries = result.data.linked_summaries;
            if (result.data.meeting_details) state.meetingDetails = result.data.meeting_details;
            if (result.data.projects) state.projects = result.data.projects;
            if (result.data.simulated_metadata) state.simulatedMetadata = result.data.simulated_metadata;

            // Sync back to localStorage for fallback
            localStorage.setItem('qm_directories', JSON.stringify(state.quickMerge.directories));
            localStorage.setItem('linked_summaries', JSON.stringify(state.quickMerge.linkedSummaries));
            // We don't sync projects to localStorage to avoid quota issues, rely on disk.
        }
        renderProjectsGrid();
    } catch (err) {
        console.error('Failed to load persistent data:', err);
    }
}

async function savePersistentData() {
    if (!window.userDataPath) return;

    const data = {
        qm_directories: state.quickMerge.directories,
        linked_summaries: state.quickMerge.linkedSummaries,
        meeting_details: state.meetingDetails,
        meeting_details: state.meetingDetails,
        projects: state.projects,
        simulated_metadata: state.simulatedMetadata,
        updated_at: new Date().toISOString()
    };

    try {
        await fetch(`${API_BASE}?action=persist_save`, {
            method: 'POST',
            body: JSON.stringify({
                userDataPath: window.userDataPath,
                data: data
            })
        });
    } catch (err) {
        console.error('Failed to save persistent data:', err);
    }
}


function initAuth() {
    if (state.user) {
        showAuthenticatedContent();
    } else {
        showLoginOverlay();
    }
}

let isGisInitialized = false;
let gisRetryCount = 0;

function showLoginOverlay() {
    console.log('Attempting to show login overlay...');
    const overlay = document.getElementById('login-overlay');
    const authContent = document.getElementById('authenticated-content');

    if (overlay) overlay.classList.remove('hidden');
    if (authContent) authContent.classList.add('hidden');

    // Initialize Google Identity Services
    if (window.google && google.accounts && google.accounts.id) {
        try {
            console.log('Google Identity Services SDK found, initializing...');
            if (!isGisInitialized) {
                google.accounts.id.initialize({
                    client_id: GOOGLE_CLIENT_ID,
                    callback: handleGoogleSignIn,
                    auto_select: false,
                    cancel_on_tap_outside: true
                });
                isGisInitialized = true;
            }

            const buttonDiv = document.getElementById('google-login-button');
            if (buttonDiv) {
                buttonDiv.innerHTML = ''; // Clear for re-rendering
                google.accounts.id.renderButton(
                    buttonDiv,
                    { theme: 'outline', size: 'large', width: 280, text: 'signin_with' }
                );
                console.log('Google login button successfully rendered');
            }
        } catch (err) {
            console.error('Error in GIS flow:', err);
            const buttonDiv = document.getElementById('google-login-button');
            if (buttonDiv) buttonDiv.innerHTML = '<div style="color:#ef4444; font-size:0.9rem; margin-top:10px;">Login service error. Please restart the app.</div>';
        }
    } else {
        gisRetryCount++;
        console.warn(`Google SDK not ready (Attempt ${gisRetryCount}), retrying in 500ms...`);
        if (gisRetryCount < 30) {
            setTimeout(showLoginOverlay, 500);
        } else {
            const buttonDiv = document.getElementById('google-login-button');
            if (buttonDiv) {
                buttonDiv.innerHTML = `
                    <div style="color:#64748b; font-size:0.9rem; margin-top:10px;">
                        Google Login loading timed out.
                        <button onclick="location.reload()" style="background:none; border:none; color:#4f46e5; text-decoration:underline; cursor:pointer; font-weight:600;">Reload</button>
                    </div>`;
            }
        }
    }
}

function logActivity(email = null) {
    const mac = window.macAddress || 'Unknown';
    const userEmail = email || (state.user ? state.user.email : 'Anonymous');

    console.log(`Reporting activity for: ${userEmail} (${mac})`);

    // Use relative path to ensure it works on current port (e.g. 8080)
    fetch('/admin/api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: userEmail,
            mac: mac,
            version: window.appVersion || 'Unknown',
            client_time: new Date().toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        })
    }).catch(err => console.error('Admin reporting failed:', err));
}

function showAuthenticatedContent() {
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('authenticated-content').classList.remove('hidden');
    updateAuthUI();

    // Log user activity on login/resume
    if (state.user && state.user.email) {
        logActivity(state.user.email);
    }

    // Sync Official Recording Directory
    syncOfficialDirectory();

    // Load Quick Merge files after auth
    setTimeout(() => {
        console.log('Loading Quick Merge files...');
        renderDirectories();
        loadAllFiles();

        // Auto-detect Google Drive for the logged in user
        if (state.user && state.user.email && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.locateGoogleDrive) {
            window.webkit.messageHandlers.locateGoogleDrive.postMessage({ email: state.user.email });
        }
    }, 200);
}

function syncOfficialDirectory() {
    if (!window.recordPath) return;

    // Check if it already exists
    const exists = state.quickMerge.directories.some(d => d === window.recordPath);
    if (!exists) {
        console.log('Adding official record directory:', window.recordPath);
        state.quickMerge.directories.unshift(window.recordPath);
        saveDirectories();
    }
}

function handleGoogleSignIn(response) {
    console.log('Google Sign-In response received');
    const user = parseJwt(response.credential);
    if (user) {
        state.user = {
            name: user.name,
            email: user.email,
            avatar: user.picture
        };
        localStorage.setItem('auth_user', JSON.stringify(state.user));

        // Log activity for the new user
        logActivity(state.user.email);

        showAuthenticatedContent();

        // Auto-detect Google Drive immediately
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.locateGoogleDrive) {
            window.webkit.messageHandlers.locateGoogleDrive.postMessage({ email: user.email });
        }
    }
}


function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        console.error('Failed to parse JWT', e);
        return null;
    }
}

function updateAuthUI() {
    if (state.user) {
        document.getElementById('user-profile').classList.remove('hidden');
        document.getElementById('user-name').textContent = state.user.name;
        document.getElementById('user-avatar').src = state.user.avatar;
    }
}

window.handleLogout = function () {
    state.user = null;
    localStorage.removeItem('auth_user');
    location.reload(); // Simplest way to reset state
};

// --- Quick Merge Logic ---

const MAX_DIRECTORIES = 5;

function saveDirectories() {
    localStorage.setItem('qm_directories', JSON.stringify(state.quickMerge.directories));
    savePersistentData(); // Sync to safe folder
}

function renderDirectories() {
    const containers = [
        document.getElementById('quick-merge-directories'),
        document.getElementById('documents-directories')
    ];

    containers.forEach(container => {
        if (!container) return;
        container.innerHTML = '';

        state.quickMerge.directories.forEach((dir, index) => {
            const hasError = state.quickMerge.directoryErrors?.[dir];
            const isOfficial = (window.recordPath && dir === window.recordPath);

            const tag = document.createElement('div');
            tag.className = 'directory-tag' + (hasError ? ' error' : '') + (isOfficial ? ' official' : '');

            const parts = dir.split('/');
            const name = parts[parts.length - 1] || dir;

            tag.title = hasError ? `Error: ${hasError}\nPath: ${dir}` : dir;
            tag.innerHTML = `
                <span class="dir-name" onclick="window.openInFinder('${dir.replace(/'/g, "\\'")}')">
                    ${isOfficial ? '🎙️' : (hasError ? '⚠️' : '📁')} ${name}${isOfficial ? ' (Official)' : ''}
                </span>
                ${isOfficial ? '' : `<span class="remove" onclick="event.stopPropagation(); removeDirectory(${index})">×</span>`}
            `;
            container.appendChild(tag);
        });

        // Add inviting "Add Folder" button at the end
        const addBtn = document.createElement('button');
        // Avoid duplicate ID if relying on ID for events, but here we use onclick.
        // Keeping ID only for the first one might be safer if CSS targets ID, but CSS targets class .btn-add-tag usually.
        addBtn.className = 'btn-add-tag';
        addBtn.innerHTML = '<span>+</span> Add Folder';
        addBtn.onclick = () => window.triggerAddDirectory();
        container.appendChild(addBtn);
    });
}

window.openInFinder = function (path) {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.openDirectory) {
        window.webkit.messageHandlers.openDirectory.postMessage({ path: path });
    } else {
        console.log('Open in Finder (Simulator):', path);
    }
};

// --- Meeting Details Logic ---
let currentMDPath = null;

window.openMeetingDetails = function (path) {
    currentMDPath = path;
    const details = state.meetingDetails[path] || {
        topic: '',
        location: '',
        participants: '',
        category: 'business',
        summary: '',
        content: '',
        actions: ''
    };

    document.getElementById('md-topic').value = details.topic || '';
    document.getElementById('md-location').value = details.location || '';
    document.getElementById('md-participants').value = details.participants || '';
    document.getElementById('md-category').value = details.category || 'business';
    document.getElementById('md-summary').value = details.summary || '';
    document.getElementById('md-content').value = details.content || '';
    document.getElementById('md-actions').value = details.actions || '';

    document.getElementById('meeting-details-modal').classList.remove('hidden');
};

window.closeMeetingDetails = function () {
    if (currentMDPath) {
        // Save current state before closing
        state.meetingDetails[currentMDPath] = {
            topic: document.getElementById('md-topic').value,
            location: document.getElementById('md-location').value,
            participants: document.getElementById('md-participants').value,
            category: document.getElementById('md-category').value,
            summary: document.getElementById('md-summary').value,
            content: document.getElementById('md-content').value,
            actions: document.getElementById('md-actions').value
        };
        savePersistentData();
    }
    document.getElementById('meeting-details-modal').classList.add('hidden');
    currentMDPath = null;
};

window.previewQuickMergeFile = function (path) {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.previewFile) {
        window.webkit.messageHandlers.previewFile.postMessage({ path: path });
    } else {
        console.log('Preview file (Space bar hack):', path);
    }
};

window.triggerAddDirectory = function () {
    if (state.quickMerge.directories.length >= MAX_DIRECTORIES) {
        showAlert('You can add up to 5 custom folders.', 'danger');
        return;
    }
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.directoryPicker) {
        window.webkit.messageHandlers.directoryPicker.postMessage({});
    } else {
        // Fallback / Debug
        const path = prompt("Enter directory path (Debug):");
        if (path) window.onDirectorySelected(path);
    }
};

window.removeDirectory = function (index) {
    const dir = state.quickMerge.directories[index];
    if (window.recordPath && dir === window.recordPath) {
        alert("The default recording folder cannot be removed.");
        return;
    }
    state.quickMerge.directories.splice(index, 1);
    saveDirectories();
    renderDirectories();
    loadAllFiles(true);
};

window.onRecordingStatus = function (isRecording, finalPath) {
    state.isRecording = isRecording;
    console.log('Recording status update:', isRecording);

    // Update Live Indicator on Tab
    const liveIndicator = document.getElementById('recordings-live');
    if (liveIndicator) {
        if (isRecording) {
            liveIndicator.classList.remove('hidden');
        } else {
            liveIndicator.classList.add('hidden');
        }
    }

    if (!isRecording) {
        // --- Highlight new recording ---
        if (finalPath) {
            console.log('Applying highlight to new recording:', finalPath);
            state.quickMerge.highlightPath = finalPath;

            // Show red dot if not on recordings tab
            if (state.currentTab !== 'quick-merge') {
                const dot = document.getElementById('recordings-dot');
                if (dot) dot.classList.remove('hidden');
            }
            // Clear highlight after 5 seconds
            setTimeout(() => {
                state.quickMerge.highlightPath = null;
                renderQuickMergeFiles();
            }, 5000);
        }
    }

    // Update Record Now button if it exists
    const recordBtn = document.getElementById('btn-record-now');
    if (recordBtn) {
        if (isRecording) {
            recordBtn.innerHTML = '<span class="record-dot recording"></span> Stop Recording';
            recordBtn.title = 'Stop Recording (^S)';
            recordBtn.classList.add('recording');
        } else {
            recordBtn.innerHTML = '<span class="record-dot"></span> Record Now';
            recordBtn.title = 'Start Recording (^R)';
            recordBtn.classList.remove('recording');
        }
    }

    // Refresh files to show the new recording
    loadAllFiles(true);
};

window.onDirectorySelected = function (path) {
    if (state.quickMerge.directories.length >= MAX_DIRECTORIES) {
        showAlert('You can add up to 5 custom folders.', 'danger');
        return;
    }
    if (state.quickMerge.directories.includes(path)) return;

    state.quickMerge.directories.push(path);
    saveDirectories();
    renderDirectories();
    loadAllFiles(true);
};

window.onGoogleDriveDetected = function (path) {
    if (state.quickMerge.directories.includes(path)) return;
    if (state.quickMerge.directories.length >= MAX_DIRECTORIES) return;

    console.log('Google Drive detected at:', path);
    state.quickMerge.directories.push(path);
    saveDirectories();
    renderDirectories();
    loadAllFiles(true);
    showAlert('Google Drive linked automatically.', 'success');
};

window.triggerRecordNow = function () {
    const recordBtn = document.getElementById('btn-record-now');
    if (window.webkit && window.webkit.messageHandlers) {
        if (state.isRecording) {
            if (recordBtn) recordBtn.innerHTML = '<span class="loading-spinner-mini"></span> Stopping...';
            window.webkit.messageHandlers.stopRecording.postMessage({});
        } else {
            if (recordBtn) recordBtn.innerHTML = '<span class="loading-spinner-mini"></span> Starting...';
            window.webkit.messageHandlers.startRecording.postMessage({});
        }
    } else {
        showAlert('Recording is only available in the Mac app.', 'info');
    }
};

const AUDIO_EXTS = ['mp3', 'm4a', 'm4b', 'aac', 'ogg', 'flac', 'wav', 'wma', 'opus', 'aiff', 'caf', 'mp4'];
const DOC_EXTS = ['pdf', 'doc', 'docx', 'txt', 'md', 'pages'];

function loadAllFiles(resetPage = false) {
    if (state.quickMerge.directories.length === 0) {
        state.quickMerge.files = [];
        state.documents.files = [];
        state.quickMerge.directoryErrors = {};
        if (resetPage) {
            state.quickMerge.currentPage = 0;
            state.documents.currentPage = 0;
        }
        renderDirectories();
        renderQuickMergeFiles();
        renderDocuments();
        return;
    }

    if (resetPage) {
        state.quickMerge.currentPage = 0;
        state.documents.currentPage = 0;
    }

    // Clear previous errors
    state.quickMerge.directoryErrors = {};

    console.log('Fetching files from:', state.quickMerge.directories);

    const promises = state.quickMerge.directories.map(path =>
        fetch(`${API_BASE}?action=list_directory&path=${encodeURIComponent(path)}`)
            .then(res => res.json())
    );

    Promise.allSettled(promises)
        .then(results => {
            let allFetchedFiles = [];
            results.forEach((result, index) => {
                const path = state.quickMerge.directories[index];
                if (result.status === 'fulfilled' && result.value.success) {
                    allFetchedFiles = [...allFetchedFiles, ...result.value.files];
                    console.log(`Directory ${path} loaded: ${result.value.files.length} files`);
                } else {
                    const error = result.reason || result.value?.error || 'Unknown error';
                    console.error(`Failed to load directory: ${path}`, error);
                    state.quickMerge.directoryErrors[path] = error;
                }
            });

            // Sort by mtime descending
            allFetchedFiles.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

            // Split into Audio and Docs
            const audioFiles = [];
            const docFiles = [];

            allFetchedFiles.forEach(f => {
                const ext = f.name.split('.').pop().toLowerCase();
                if (AUDIO_EXTS.includes(ext)) {
                    audioFiles.push(f);
                } else if (DOC_EXTS.includes(ext)) {
                    docFiles.push(f);
                }
            });

            state.quickMerge.files = audioFiles;
            state.documents.files = docFiles;

            renderDirectories(); // Re-render to show error states
            renderQuickMergeFiles();
            renderDocuments();

            // Refresh project view if it's open (since metadata might have updated)
            const projectView = document.getElementById('project-detail-view');
            const projectDetailTitle = document.getElementById('project-detail-title');
            if (projectView && !projectView.classList.contains('hidden') && projectDetailTitle.dataset.id) {
                const project = state.projects.find(p => p.id === projectDetailTitle.dataset.id);
                if (project) {
                    renderProjectDetailFiles(project);
                }
            }

            // Check if any file is still extracting, if so, schedule a refresh
            const stillExtracting = audioFiles.some(f => f.is_extracting);
            if (stillExtracting) {
                console.log('Some files are still extracting, scheduling refresh in 3s...');
                if (state.quickMerge.extractionRefeshTimeout) {
                    clearTimeout(state.quickMerge.extractionRefeshTimeout);
                }
                state.quickMerge.extractionRefeshTimeout = setTimeout(() => {
                    loadAllFiles(false);
                }, 3000);
            }
        })
        .catch(err => {
            console.error('Unexpected error in loadAllFiles:', err);
            showAlert('Unable to load folders.', 'danger');
        });
}

function findLinkedAudio(docPath) {
    const docName = docPath.split('/').pop();

    // Check simulated metadata first (newly created links)
    for (const [audioPath, meta] of Object.entries(state.simulatedMetadata || {})) {
        if (meta.linkedDocuments && meta.linkedDocuments.some(d => d.name === docName)) {
            const audioName = (meta.name) ? meta.name : audioPath.split('/').pop();
            return { path: audioPath, name: audioName };
        }
    }

    // Check main files (pre-existing links)
    if (state.quickMerge.files) {
        for (const file of state.quickMerge.files) {
            const simMeta = state.simulatedMetadata[file.path] || {};
            // Use simulated list if exists, otherwise file's own list (if backend provided)
            const linkedDocs = simMeta.linkedDocuments || file.linkedDocuments;

            if (linkedDocs && linkedDocs.some(d => d.name === docName)) {
                return { path: file.path, name: file.name };
            }
        }
    }
    return null;
}

// --- Documents Logic ---
function renderDocuments() {
    const container = document.getElementById('documents-file-list');
    const pagination = document.getElementById('documents-pagination');
    if (!container) return;

    container.innerHTML = '';

    if (state.documents.files.length === 0) {
        container.innerHTML = '<p class="empty-state">No document files found in directory</p>';
        pagination.classList.add('hidden');
        return;
    }

    // --- Timeline & Pagination Logic ---
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - (24 * 60 * 60 * 1000);

    const formatDate = (timestamp) => {
        const date = new Date(timestamp);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    // Filter by age and add original index
    const allFiles = state.documents.files
        .map((f, i) => ({ ...f, _originalIndex: i }));

    // Calculate Pages
    const PAGE_SIZE = 15;
    const pages = [];
    let curIdx = 0;
    while (curIdx < allFiles.length) {
        let endIdx = Math.min(curIdx + PAGE_SIZE, allFiles.length);

        if (endIdx < allFiles.length) {
            const lastItemDateStr = new Date(allFiles[endIdx - 1].mtime * 1000).toDateString();
            while (endIdx < allFiles.length) {
                const nextItemDateStr = new Date(allFiles[endIdx].mtime * 1000).toDateString();
                if (nextItemDateStr === lastItemDateStr) {
                    endIdx++;
                } else {
                    break;
                }
            }
        }
        pages.push(allFiles.slice(curIdx, endIdx));
        curIdx = endIdx;
    }

    if (state.documents.currentPage >= pages.length) state.documents.currentPage = Math.max(0, pages.length - 1);

    const currentPageFiles = pages[state.documents.currentPage] || [];

    // Group current page files by date
    const groupsMap = new Map();
    currentPageFiles.forEach(file => {
        const fileTime = file.mtime * 1000;
        const dateObj = new Date(fileTime);
        const dayStart = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()).getTime();

        const formattedDate = formatDate(fileTime);
        let label = (dayStart === todayStart) ? `Today (${formattedDate})` :
            (dayStart === yesterdayStart) ? `Yesterday (${formattedDate})` : formattedDate;

        if (!groupsMap.has(dayStart)) {
            groupsMap.set(dayStart, { label, files: [] });
        }
        groupsMap.get(dayStart).files.push(file);
    });

    const sortedGroups = Array.from(groupsMap.values());

    sortedGroups.forEach(group => {
        const groupHeader = document.createElement('div');
        groupHeader.className = 'timeline-header';
        groupHeader.textContent = group.label;
        container.appendChild(groupHeader);

        group.files.forEach(file => {
            const index = file._originalIndex;
            const isSelected = state.documents.selectedFiles.includes(index);
            const isEditing = state.documents.editingFileIndex === index;

            const el = document.createElement('label'); // Use label for checkbox click area
            el.className = 'file-item' + (isSelected ? ' selected' : '');

            // Name Content (Normal or Edit Mode)
            let nameContent = `
                <div class="file-name" onclick="event.preventDefault(); event.stopPropagation(); previewQuickMergeFile('${file.path.replace(/'/g, "\\'")}')">

                    <span style="cursor: pointer;">${file.name}</span>
                    <span class="btn-locate" title="Reveal in Finder" style="margin-left: 8px;" onclick="event.preventDefault(); event.stopPropagation(); window.webkit?.messageHandlers?.openDirectory?.postMessage({ path: '${file.path.replace(/'/g, "\\'")}' })">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    </span>
                    <span class="btn-rename" onclick="event.preventDefault(); event.stopPropagation(); startDocumentRename(${index})">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </span>
                </div>
            `;

            if (isEditing) {
                nameContent = `
                    <div class="file-name">
                        <input type="text" class="rename-input" id="doc-rename-input-${index}" 
                               value="${file.name.substring(0, file.name.lastIndexOf('.')) || file.name}" 
                               onclick="event.preventDefault(); event.stopPropagation();">
                    </div>
                `;
            }

            el.innerHTML = `
                <input type="checkbox" 
                    id="doc-file-${index}" 
                    ${isSelected ? 'checked' : ''}
                    ${isEditing ? 'disabled' : ''}
                    onchange="toggleDocumentFile(${index})">
                    
                <div class="file-item-content">
                    <div class="file-main" style="display:flex; align-items:center; justify-content:space-between; width:100%;">
                        <div class="file-info" style="flex:1;">
                            ${nameContent}
                            <div class="file-meta">
                                ${formatSize(file.size)}
                            </div>
                        </div>
                        
                        ${(function () {
                    const linkedAudio = findLinkedAudio(file.path);
                    if (linkedAudio) {
                        return `
                                    <div style="margin-left:auto; display:flex; align-items:center; gap:8px; color:var(--primary-color); font-size:0.85rem; font-weight:500;">
                                        <span style="font-size:1rem;">🔗</span>
                                        <span>Linked to ${linkedAudio.name}</span>
                                        <button class="btn-link" style="color:var(--error-color); padding:2px 6px; font-size:0.75rem; border:1px solid #fee2e2; border-radius:4px; margin-left:4px;" 
                                            onclick="event.preventDefault(); event.stopPropagation(); unlinkAudio('${file.path.replace(/'/g, "\\'")}')" title="Unlink">
                                            Unlink
                                        </button>
                                    </div>
                                `;
                    } else {
                        return `
                                    <div style="margin-left:auto;">
                                        <button class="btn btn-secondary btn-sm" onclick="event.preventDefault(); event.stopPropagation(); openLinkAudioModal('${file.path.replace(/'/g, "\\'")}')">
                                            Link Audio
                                        </button>
                                    </div>
                                `;
                    }
                })()}
                    </div>
                </div>
            `;
            container.appendChild(el);
        });
    });

    // Pagination Controls
    if (pages.length > 1) {
        pagination.classList.remove('hidden');
        document.getElementById('doc-page-info').textContent = `Page ${state.documents.currentPage + 1} of ${pages.length}`;
        pagination.querySelector('button:first-child').disabled = state.documents.currentPage === 0;
        pagination.querySelector('button:last-child').disabled = state.documents.currentPage >= pages.length - 1;
    } else {
        pagination.classList.add('hidden');
    }
}

// --- Document Interactions ---

window.toggleDocumentFile = function (index) {
    const selectedIndex = state.documents.selectedFiles.indexOf(index);
    if (selectedIndex !== -1) {
        state.documents.selectedFiles.splice(selectedIndex, 1);
    } else {
        state.documents.selectedFiles.push(index);
    }
    updateDocumentsButton();
    renderDocuments();
};

window.startDocumentRename = function (index) {
    state.documents.editingFileIndex = index;
    renderDocuments();
    // Focus input
    setTimeout(() => {
        const input = document.getElementById(`doc-rename-input-${index}`);
        if (input) {
            input.focus();
            input.select();
            // Handle enter/blur
            input.onblur = () => commitDocumentRename(index, input.value);
            input.onkeydown = (e) => {
                if (e.key === 'Enter') commitDocumentRename(index, input.value);
                if (e.key === 'Escape') {
                    state.documents.editingFileIndex = null;
                    renderDocuments();
                }
            };
        }
    }, 50);
};

window.commitDocumentRename = function (index, newName) {
    if (state.documents.editingFileIndex === null) return;

    const file = state.documents.files[index];
    const oldPath = file.path;
    const oldName = file.name;
    const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/'));

    // Validate
    if (!newName || newName.trim() === '') {
        state.documents.editingFileIndex = null;
        renderDocuments();
        return;
    }

    const ext = oldName.includes('.') ? '.' + oldName.split('.').pop() : '';
    if (!newName.endsWith(ext)) newName += ext;

    const newPath = `${parentDir}/${newName}`;

    if (newPath === oldPath) {
        state.documents.editingFileIndex = null;
        renderDocuments();
        return;
    }

    // Perform rename
    fetch(`${API_BASE}?action=rename_file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_path: oldPath, new_path: newPath })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                // Update local state immediately
                file.name = newName;
                file.path = newPath;
                state.documents.editingFileIndex = null;
                showAlert('Renamed successfully', 'success');
                renderDocuments();
            } else {
                showAlert(data.error || 'Rename failed', 'danger');
                state.documents.editingFileIndex = null;
                renderDocuments();
            }
        })
        .catch(err => {
            console.error(err);
            showAlert('Rename failed', 'danger');
            state.documents.editingFileIndex = null;
            renderDocuments();
        });
};


window.openLinkAudioModal = function (docPath) {
    state.linkingDocPath = docPath;
    const modal = document.getElementById('link-audio-modal');
    const list = document.getElementById('link-audio-list');
    list.innerHTML = '';

    if (!state.quickMerge.files || state.quickMerge.files.length === 0) {
        list.innerHTML = '<p class="text-gray-500">No audio recordings found.</p>';
    } else {
        // Sort by date desc
        const files = [...state.quickMerge.files].sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

        files.forEach((file, idx) => {
            const simMeta = state.simulatedMetadata[file.path];
            const displayName = simMeta && simMeta.name ? simMeta.name : file.name;
            const isAudio = !['pdf', 'doc', 'docx', 'txt', 'md'].includes(file.name.split('.').pop().toLowerCase());

            if (isAudio) {
                const div = document.createElement('div');
                div.style.padding = '8px';
                div.style.borderBottom = '1px solid #f3f4f6';
                div.style.display = 'flex';
                div.style.alignItems = 'center';
                div.style.gap = '10px';

                div.innerHTML = `
                    <input type="radio" name="audio-link-selection" id="audio-link-${idx}" value="${file.path.replace(/"/g, '&quot;')}" style="cursor:pointer;">
                    <label for="audio-link-${idx}" style="cursor:pointer; flex:1; font-size:0.9rem;">
                        <span style="margin-right:6px;">🎵</span> ${displayName}
                    </label>
                 `;
                list.appendChild(div);
            }
        });
    }

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
};

window.closeLinkAudioModal = function () {
    const modal = document.getElementById('link-audio-modal');
    modal.classList.remove('active');
    setTimeout(() => { modal.style.display = 'none'; }, 200);
    state.linkingDocPath = null;
};

window.submitLinkAudio = function () {
    if (!state.linkingDocPath) return;

    const selected = document.querySelector('input[name="audio-link-selection"]:checked');
    if (!selected) {
        alert("Please select an audio file.");
        return;
    }

    const audioPath = selected.value;
    const docPath = state.linkingDocPath;
    const docName = docPath.split('/').pop();

    // Init metadata for this audio if not exists
    if (!state.simulatedMetadata[audioPath]) {
        const file = state.quickMerge.files.find(f => f.path === audioPath);
        state.simulatedMetadata[audioPath] = {
            path: audioPath,
            name: file ? file.name : audioPath.split('/').pop(),
            linkedDocuments: []
        };
    }

    const meta = state.simulatedMetadata[audioPath];
    if (!meta.linkedDocuments) meta.linkedDocuments = [];

    // Add if not exists
    if (!meta.linkedDocuments.some(d => d.name === docName)) {
        meta.linkedDocuments.push({ name: docName, path: docPath, type: 'manual' });
    }

    savePersistentData();
    closeLinkAudioModal();
    renderDocuments();
    showAlert(`Linked to audio successfully!`, 'success');

    if (state.currentTab === 'quick-merge') {
        renderQuickMergeFiles();
    }
};

window.unlinkAudio = function (docPath) {
    if (!confirm("Are you sure you want to unlink this document from the audio?")) return;

    const docName = docPath.split('/').pop();
    let found = false;

    // Scan simulated metadata to find the link
    for (const [audioPath, meta] of Object.entries(state.simulatedMetadata || {})) {
        if (meta.linkedDocuments) {
            const idx = meta.linkedDocuments.findIndex(d => d.name === docName);
            if (idx !== -1) {
                meta.linkedDocuments.splice(idx, 1);
                found = true;
                // Don't break immediately, in case it's linked in multiple places (unlikely but possible)
            }
        }
    }

    if (found) {
        savePersistentData();
        renderDocuments();
        showAlert("Document unlinked successfully.", "success");
        if (state.currentTab === 'quick-merge') {
            renderQuickMergeFiles();
        }
    } else {
        // Fallback scan if it was a pre-existing link not in simulatedMetadata (less likely with current logic)
        showAlert("Could not find the link to remove.", "warning");
    }
};

function updateDocumentsButton() {
    const btn = document.getElementById('btn-delete-documents');
    if (!btn) return;
    const count = state.documents.selectedFiles.length;
    btn.disabled = count === 0;
    btn.textContent = count > 0 ? `🗑️ Delete (${count})` : '🗑️ Delete';
    btn.style.opacity = count > 0 ? '1' : '0.5';
}

window.deleteSelectedDocuments = function () {
    const count = state.documents.selectedFiles.length;
    if (count === 0) return;

    if (!confirm(`Are you sure you want to delete ${count} document(s)? This action cannot be undone.`)) return;

    const filesToDelete = state.documents.selectedFiles.map(idx => state.documents.files[idx].path);

    fetch(`${API_BASE}?action=delete_recordings`, { // Reusing delete endpoint (it deletes files)
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_paths: filesToDelete })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showAlert(`Deleted ${data.deleted_count} file(s)`, 'success');
                state.documents.selectedFiles = [];
                loadAllFiles(); // Refresh list
            } else {
                showAlert(data.error || 'Delete failed', 'danger');
            }
        })
        .catch(err => {
            console.error(err);
            showAlert('Delete failed', 'danger');
        });
};

window.changeDocumentsPage = function (delta) {
    state.documents.currentPage += delta;
    renderDocuments();
    // Scroll to top of list
    document.getElementById('documents-file-list').scrollTop = 0;
};

function renderQuickMergeFiles() {
    const container = document.getElementById('quick-merge-file-list');
    const pagination = document.getElementById('quick-merge-pagination');
    container.innerHTML = '';

    if (state.quickMerge.files.length === 0) {
        container.innerHTML = '<p class="empty-state">No audio files found in directory</p>';
        pagination.classList.add('hidden');
        return;
    }

    // --- Timeline & Pagination Logic ---
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - (24 * 60 * 60 * 1000);

    const formatDate = (timestamp) => {
        const date = new Date(timestamp);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    // Filter by age and add original index
    const allFiles = state.quickMerge.files
        .map((f, i) => ({ ...f, _originalIndex: i }));

    // Calculate Pages (15 items min, but complete the day)
    const PAGE_SIZE = 15;
    const pages = [];
    let curIdx = 0;
    while (curIdx < allFiles.length) {
        let endIdx = Math.min(curIdx + PAGE_SIZE, allFiles.length);

        // Final item of the 15-count
        if (endIdx < allFiles.length) {
            const lastItemDateStr = new Date(allFiles[endIdx - 1].mtime * 1000).toDateString();
            while (endIdx < allFiles.length) {
                const nextItemDateStr = new Date(allFiles[endIdx].mtime * 1000).toDateString();
                if (nextItemDateStr === lastItemDateStr) {
                    endIdx++; // Add trailing items from the same day
                } else {
                    break;
                }
            }
        }
        pages.push(allFiles.slice(curIdx, endIdx));
        curIdx = endIdx;
    }

    // Adjust currentPage if out of bounds
    if (state.quickMerge.currentPage >= pages.length) state.quickMerge.currentPage = Math.max(0, pages.length - 1);

    const currentPageFiles = pages[state.quickMerge.currentPage] || [];

    // Group current page files by date
    const groupsMap = new Map();
    currentPageFiles.forEach(file => {
        const fileTime = file.mtime * 1000;
        const dateObj = new Date(fileTime);
        const dayStart = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()).getTime();

        const formattedDate = formatDate(fileTime);
        let label = (dayStart === todayStart) ? `Today (${formattedDate})` :
            (dayStart === yesterdayStart) ? `Yesterday (${formattedDate})` : formattedDate;

        if (!groupsMap.has(dayStart)) {
            groupsMap.set(dayStart, { label, files: [] });
        }
        groupsMap.get(dayStart).files.push(file);
    });

    // Sort groups descending
    const sortedStarts = Array.from(groupsMap.keys()).sort((a, b) => b - a);

    // Render groups
    sortedStarts.forEach(start => {
        const group = groupsMap.get(start);
        const header = document.createElement('div');
        header.className = 'timeline-header';
        header.textContent = group.label;
        container.appendChild(header);

        group.files.forEach(file => {
            const index = file._originalIndex;
            const html = renderFileItemHTML(file, index, {
                showProjectTag: true,
                showCheckbox: true,
                isQuickMerge: true
            });
            container.appendChild(html);
        });
    });

    // Update Pagination UI
    if (pages.length > 1) {
        pagination.classList.remove('hidden');
        document.getElementById('qm-page-info').textContent = `Page ${state.quickMerge.currentPage + 1} of ${pages.length}`;
        pagination.children[0].disabled = state.quickMerge.currentPage === 0; // Newer
        pagination.children[2].disabled = state.quickMerge.currentPage === pages.length - 1; // Older
    } else {
        pagination.classList.add('hidden');
    }

    updateQuickMergeButton();
}

window.changeQMPage = function (delta) {
    state.quickMerge.currentPage += delta;
    renderQuickMergeFiles();
    document.getElementById('quick-merge-file-list').scrollTop = 0;
};

window.toggleQuickMergeFile = function (index) {
    const selectedIndex = state.quickMerge.selectedFiles.indexOf(index);

    if (selectedIndex !== -1) {
        // File is already selected, remove it
        state.quickMerge.selectedFiles.splice(selectedIndex, 1);
    } else {
        // File is not selected, add it to the end
        state.quickMerge.selectedFiles.push(index);
    }

    updateQuickMergeButton();
    renderQuickMergeFiles();
};

window.linkQuickMergeFile = function (index) {
    const file = state.quickMerge.files[index];
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.linkFilePicker) {
        window.webkit.messageHandlers.linkFilePicker.postMessage({ path: file.path });
    } else {
        showAlert('Link feature is only available in the Mac App.', 'info');
    }
};

window.onFileLinked = function (audioPath, summary, docPath) {
    state.quickMerge.linkedSummaries[audioPath] = {
        text: summary,
        path: docPath
    };
    localStorage.setItem('linked_summaries', JSON.stringify(state.quickMerge.linkedSummaries));
    savePersistentData(); // Sync to safe folder
    renderQuickMergeFiles();
};

window.toggleDocDetails = function (index) {
    if (state.quickMerge.expandedDocIndex === index) {
        state.quickMerge.expandedDocIndex = null;
    } else {
        state.quickMerge.expandedDocIndex = index;
    }
    renderQuickMergeFiles();
}

window.clearQuickMergeLink = function (index) {
    const file = state.quickMerge.files[index];
    delete state.quickMerge.linkedSummaries[file.path];
    localStorage.setItem('linked_summaries', JSON.stringify(state.quickMerge.linkedSummaries));
    savePersistentData(); // Sync to safe folder
    renderQuickMergeFiles();
}

window.startQuickMergeRename = function (index) {
    state.quickMerge.editingFileIndex = index;
    renderQuickMergeFiles();
};

window.cancelQuickMergeRename = function () {
    state.quickMerge.editingFileIndex = null;
    renderQuickMergeFiles();
};

window.saveQuickMergeRename = function (index, newName) {
    const file = state.quickMerge.files[index];
    if (!newName || newName.trim() === '') {
        cancelQuickMergeRename();
        return;
    }

    const btn = document.querySelector(`.btn-rename[onclick*="${index}"]`);
    if (btn) btn.innerHTML = '<span class="loading-spinner-mini"></span>';

    fetch(`${API_BASE}?action=rename_file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            oldPath: file.path,
            newName: newName.trim()
        })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                // Update local state directly instead of full reload
                state.quickMerge.editingFileIndex = null;

                const oldPath = file.path;

                // Update the file object in state
                file.path = data.newPath;
                file.name = data.newName;

                // If there was a linked summary, we need to update its key (path changed)
                if (state.quickMerge.linkedSummaries[oldPath]) {
                    const summary = state.quickMerge.linkedSummaries[oldPath];
                    delete state.quickMerge.linkedSummaries[oldPath];
                    state.quickMerge.linkedSummaries[data.newPath] = summary;
                    localStorage.setItem('linked_summaries', JSON.stringify(state.quickMerge.linkedSummaries));
                }

                // Re-render the list immediately
                renderQuickMergeFiles();
                showAlert('Renamed successfully', 'success');
            } else {
                showAlert(data.error || 'Rename failed', 'danger');
                cancelQuickMergeRename();
            }
        })
        .catch(err => {
            console.error(err);
            showAlert('Rename failed due to network error', 'danger');
            cancelQuickMergeRename();
        });
};

function updateQuickMergeButton() {
    const mergeBtn = document.getElementById('btn-quick-merge');
    const deleteBtn = document.getElementById('btn-delete-recordings');
    const count = state.quickMerge.selectedFiles.length;

    // Merge requires at least 2 files
    mergeBtn.disabled = count < 2;
    mergeBtn.textContent = count >= 2 ? `🚀 Merge (${count} files)` : '🚀 Merge';

    // Delete requires at least 1 file and NOT processing
    if (deleteBtn) {
        deleteBtn.disabled = count < 1 || state.quickMerge.isProcessing;
        deleteBtn.textContent = count >= 1 ? `🗑️ Delete (${count})` : '🗑️ Delete';
    }
}

window.deleteSelectedRecordings = function () {
    const count = state.quickMerge.selectedFiles.length;
    if (count === 0) return;

    if (!confirm(`Are you sure you want to delete ${count} file(s)? This action cannot be undone.`)) {
        return;
    }

    const selectedFilePaths = state.quickMerge.selectedFiles
        .map(index => state.quickMerge.files[index].path);

    fetch(`${API_BASE}?action=delete_recordings`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ paths: selectedFilePaths })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                // Issue: Slow refresh feedback. 
                // Solution: Immediately remove from local state for instant UI update
                state.quickMerge.files = state.quickMerge.files.filter((file, index) => !state.quickMerge.selectedFiles.includes(index));
                state.quickMerge.selectedFiles = [];

                renderQuickMergeFiles(); // Immediate UI update
                showAlert(`Successfully deleted ${data.deleted_count} file(s)`, 'success');

                // Then sync with server to be sure
                loadAllFiles();
            } else {
                showAlert(data.error || 'Failed to delete files', 'danger');
            }
        })
        .catch(err => {
            console.error(err);
            showAlert('An error occurred while deleting files', 'danger');
        });
};

window.deleteQuickMergeFile = function (path) {
    if (!confirm('Are you sure you want to delete this file? This cannot be undone.')) return;

    fetch(`${API_BASE}?action=delete_recordings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_paths: [path] })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showAlert('File deleted successfully', 'success');
                loadAllFiles();
            } else {
                showAlert(data.error || 'Failed to delete file', 'danger');
            }
        })
        .catch(err => {
            console.error(err);
            showAlert('Delete failed', 'danger');
        });
};

function startQuickMerge() {
    if (state.quickMerge.selectedFiles.length < 2) return;

    const btn = document.getElementById('btn-quick-merge');
    state.quickMerge.isProcessing = true;
    updateQuickMergeButton(); // Ensure delete is disabled
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner"></span> Merging...';

    // Hide previous results
    document.getElementById('quick-merge-result-area').classList.add('hidden');

    // Get selected file paths in selection order
    const selectedFiles = state.quickMerge.selectedFiles
        .map(index => state.quickMerge.files[index]);

    // Upload paths to backend
    const formData = new FormData();
    formData.append('file_paths', JSON.stringify(selectedFiles));

    fetch(`${API_BASE}?action=upload_paths`, {
        method: 'POST',
        body: formData
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                state.quickMerge.taskId = data.taskId;
                // Determine destination directory (use folder of first selected file)
                const firstFilePath = selectedFiles[0].path;
                const destDir = firstFilePath.substring(0, firstFilePath.lastIndexOf('/'));

                return fetch(`${API_BASE}?action=merge`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        taskId: data.taskId,
                        options: {
                            audioBitrate: '96k',
                            destinationDir: destDir
                        }
                    })
                });
            } else {
                throw new Error(data.error || 'Upload failed');
            }
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                pollQuickMergeStatus();
            } else {
                throw new Error(data.error || 'Merge failed');
            }
        })
        .catch(err => {
            console.error(err);
            showAlert(err.message, 'danger');
            btn.disabled = false;
            btn.textContent = '🚀 Start Merge';
        });
}

function pollQuickMergeStatus() {
    if (!state.quickMerge.taskId) return;

    fetch(`${API_BASE}?action=status&taskId=${state.quickMerge.taskId}`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const btn = document.getElementById('btn-quick-merge');
                btn.innerHTML = `<span class="loading-spinner"></span> ${data.progress}%`;

                if (data.status === 'completed') {
                    state.quickMerge.isProcessing = false;
                    updateQuickMergeButton();
                    showQuickMergeResult();
                    btn.innerHTML = '✅ Done';
                } else if (data.status === 'failed') {
                    state.quickMerge.isProcessing = false;
                    updateQuickMergeButton();
                    showAlert('Merge failed', 'danger');
                    btn.disabled = false;
                    btn.textContent = '🚀 Start Merge';
                } else {
                    state.quickMerge.statusTimeout = setTimeout(pollQuickMergeStatus, 2000);
                }
            }
        });
}

function showQuickMergeResult() {
    console.log('Fetching output for taskId:', state.quickMerge.taskId);
    fetch(`${API_BASE}?action=list_output&taskId=${state.quickMerge.taskId}`)
        .then(res => res.json())
        .then(data => {
            console.log('Output data received:', data);
            if (data.success && data.files.length > 0) {
                // Ensure the result area is visible
                const resultArea = document.getElementById('quick-merge-result-area');
                resultArea.classList.remove('hidden');
                resultArea.scrollIntoView({ behavior: 'smooth' });

                const container = document.getElementById('quick-merge-result-links');
                container.innerHTML = '';

                data.files.forEach(file => {
                    const a = document.createElement('a');
                    a.href = `${API_BASE}${file.downloadUrl}`;
                    a.className = 'download-link';
                    a.innerHTML = `<span>📥</span> Download`;
                    container.appendChild(a);

                    // Add Locate button (Reveal in Finder)
                    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.openDirectory) {
                        const locateBtn = document.createElement('button');
                        locateBtn.className = 'btn btn-secondary';
                        locateBtn.style.marginLeft = '12px';
                        locateBtn.innerHTML = '🔍 Locate';
                        locateBtn.onclick = () => {
                            window.webkit.messageHandlers.openDirectory.postMessage({ path: file.path });
                        };
                        container.appendChild(locateBtn);
                    }

                    // Add Analyze button (Open in IMA)
                    const analyzeBtn = document.createElement('button');
                    analyzeBtn.className = 'btn btn-secondary';
                    analyzeBtn.style.marginLeft = '12px';
                    analyzeBtn.id = 'btn-analyze-summary-quick';
                    analyzeBtn.innerHTML = '✨ Open in IMA';
                    analyzeBtn.onclick = (e) => analyzeAudio(state.quickMerge.taskId, e.currentTarget);
                    container.appendChild(analyzeBtn);
                });

                document.getElementById('quick-merge-result-area').classList.remove('hidden');
            }
        });
}

// --- UI Logic ---

function initTabs() {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Deactivate all
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            // Activate clicked
            tab.classList.add('active');
            const targetId = tab.dataset.tab;
            document.getElementById(`${targetId}-tab`).classList.add('active');
            state.currentTab = targetId;

            // Clear red dot if switching to recordings
            if (targetId === 'quick-merge') {
                const dot = document.getElementById('recordings-dot');
                if (dot) dot.classList.add('hidden');
            }
        });
    });
}

function showOverlay(msg) {
    const overlay = document.getElementById('upload-overlay');
    const msgEl = overlay.querySelector('p');
    if (msgEl) msgEl.textContent = msg;
    overlay.classList.add('active');
}

function hideOverlay() {
    document.getElementById('upload-overlay').classList.remove('active');
}

function showAlert(message, type = 'info') {
    // Create a toast notification
    const container = document.querySelector('.main-container');
    const alert = document.createElement('div');
    alert.className = `content-card`;
    alert.style.padding = '1rem';
    alert.style.background = type === 'danger' ? '#fee2e2' : '#ecfdf5';
    alert.style.color = type === 'danger' ? '#b91c1c' : '#047857';
    alert.style.position = 'fixed';
    alert.style.top = '20px';
    alert.style.right = '20px';
    alert.style.zIndex = '2000';
    alert.style.maxWidth = '300px';
    alert.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)';
    alert.innerHTML = `<strong>${type === 'danger' ? 'Error' : 'Info'}:</strong> ${message}`;

    document.body.appendChild(alert);
    setTimeout(() => alert.remove(), 5000);
}

// --- File Handling: Merge ---

function initDragAndDrop() {
    // Merge Area
    const mergeDrop = document.getElementById('merge-upload-area');
    setupDropZone(mergeDrop, (files) => uploadMergeFiles(files));
}

function setupDropZone(el, callback) {
    if (!el) return;

    el.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.classList.add('dragover');
    });

    el.addEventListener('dragleave', () => {
        el.classList.remove('dragover');
    });

    el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('dragover');
        callback(e.dataTransfer.files);
    });

    el.addEventListener('click', (e) => {
        const inputId = el.dataset.input;
        const input = document.getElementById(inputId);
        if (input) {
            console.log('Drop zone clicked, triggering input:', inputId);
            input.click();
        }
    });
}

function initFileUploads() {
    const mergeInput = document.getElementById('merge-file-input');
    if (mergeInput) {
        mergeInput.addEventListener('change', (e) => uploadMergeFiles(e.target.files));
    }
}

// --- Merge Logic ---

function uploadMergeFiles(files) {
    if (files.length === 0) return;

    showOverlay("Uploading...");
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append('files[]', files[i]);
    }

    if (state.merge.taskId) {
        formData.append('taskId', state.merge.taskId);
    }

    fetch(`${API_BASE}?action=upload`, {
        method: 'POST',
        body: formData
    })
        .then(res => res.json())
        .then(data => {
            hideOverlay();
            if (data.success) {
                if (state.merge.taskId === data.taskId) {
                    state.merge.files = [...state.merge.files, ...data.files];
                } else {
                    state.merge.taskId = data.taskId;
                    state.merge.files = data.files;
                }
                renderMergeUI();
            } else {
                showAlert(data.error || 'Upload failed', 'danger');
            }
        })
        .catch(err => {
            hideOverlay();
            console.error(err);
            showAlert('Upload error: ' + err.message, 'danger');
        });
}

// Called by Native App (Swift)
window.handleNativeUpload = function (files, type = null) {
    const uploadType = type || state.nextUploadType || 'merge';
    console.log(`Native upload for ${uploadType}:`, files);

    if (uploadType === 'project-docs') {
        const targetId = state.projectActionTargetId;
        console.log('Adding docs to project:', targetId, files);

        if (!targetId) {
            console.error('TargetId missing for project-docs upload');
            return;
        }

        const project = state.projects.find(p => p.id === targetId);
        if (project) {
            if (!project.filesMetadata) project.filesMetadata = {};
            files.forEach(f => {
                // Add to project files
                if (!project.files.includes(f.path)) {
                    project.files.push(f.path);
                }

                // Persist metadata within the project so it's not lost on reload
                project.filesMetadata[f.path] = {
                    ...f,
                    _originalIndex: state.quickMerge.files.length + files.indexOf(f)
                };

                // Also cache in current session state
                if (!state.quickMerge.files.find(item => item.path === f.path)) {
                    state.quickMerge.files.push(project.filesMetadata[f.path]);
                }
            });
            savePersistentData();
            renderProjectDetailFiles(project);
            renderProjectsGrid();
        }

        // Clear target
        state.projectActionTargetId = null;
        state.nextUploadType = null; // Reset to default
        return;
    }

    console.log(`Native upload for ${type}:`, files);

    // Duplicate Detection (files is array of objects: [{name, path, size}])
    if (type === 'merge' && state.merge.files.length > 0) {
        const existingNames = new Set(state.merge.files.map(f => f.name));
        const duplicates = files.filter(file => {
            return existingNames.has(file.name);
        });

        if (duplicates.length > 0) {
            alert(`Duplicate files detected:\n${duplicates.map(f => f.name).join('\n')}\n\nPlease reselect without duplicates.`);
            return;
        }
    }

    showOverlay("Uploading...");

    const formData = new FormData();
    // files is already array of objects expected by api.php
    formData.append('file_paths', JSON.stringify(files));

    // Add existing taskId if merging
    if (type === 'merge' && state.merge.taskId) {
        formData.append('taskId', state.merge.taskId);
    }

    // For split, we might need a separate action or parameter if the backend handles 'upload_paths' differently for split?
    // Actually, 'upload_paths' in api.php seems to assume 'merge' context (appending files).
    // Let's check api.php behavior. If it just returns a taskId and file list, we can use it.
    // But for split, we only want ONE file.
    // If api.php 'upload_paths' is designed for merge (multiple files), we might need to handle the response differently.

    fetch(`${API_BASE}?action=upload_paths`, {
        method: 'POST',
        body: formData
    })
        .then(res => res.text()) // get text first to debug
        .then(text => {
            try {
                // sanitize response
                const jsonStart = text.indexOf('{');
                const jsonEnd = text.lastIndexOf('}');
                if (jsonStart < 0) throw new Error("Invalid response");
                const json = text.substring(jsonStart, jsonEnd + 1);
                return JSON.parse(json);
            } catch (e) {
                console.error("Raw response:", text);
                alert("Server Error (Raw): " + text.substring(0, 500));
                throw new Error("Server response parsing failed");
            }
        })
        .then(data => {
            hideOverlay();
            if (data.success) {
                if (type === 'merge') {
                    if (state.merge.taskId === data.taskId) {
                        // Append new files to existing list
                        state.merge.files = [...state.merge.files, ...data.files];
                    } else {
                        state.merge.taskId = data.taskId;
                        state.merge.files = data.files;
                    }
                    renderMergeUI();
                } else if (type === 'split') {
                    // For split, we just want the last uploaded file
                    if (data.files && data.files.length > 0) {
                        const lastFile = data.files[data.files.length - 1];
                        state.split.file = lastFile; // This is an object from backend
                        // Note: uploadMergeFiles used File object for split. 
                        // Here we have backend object. We need to adapt selectSplitFile to handle this.
                        // Or more simply:
                        state.split.taskId = data.taskId; // Implicitly created task

                        // We need to support 'split' using a file path reference, not just browser File object.
                        // Does startSplit() support this?
                        // startSplit() builds FormData with 'file' (File object). 
                        // If we have a backend file, we can't send 'File' object.
                        // We need to check if we can pass 'taskId' and 'fileName' to split action?
                    }
                    // TODO: Handle split logic for native files. 
                    // Currently 'split' in api.php requires uploading a file via $_FILES.
                    // It does NOT seem to support 'use existing file from task'.
                    // If I'm wrong, I need to check api.php again.
                    // Assuming for now user only cares about MERGE based on "file list" complaint.
                    // But let's support split UI at least.
                    if (data.files.length > 0) {
                        // Since we can't easily refactor 'split' backend action now, 
                        // and 'upload_paths' creates a 'merge' task (conceptually), 
                        // we might be stuck. 
                        // BUT, if the user just wants to merge, let's prioritize that.
                        // The user said "Dialog select file... no list appeared". This usually implies Merge list.
                    }
                }
            } else {
                showAlert(data.error || 'Upload failed', 'danger');
            }
        })
        .catch(err => {
            hideOverlay();
            console.error(err);
            showAlert('Upload error: ' + err.message, 'danger');
        });
};



// --- AI Summary Logic ---

// --- AI Summary Logic (Local AI) ---

window.analyzeAudio = function (taskId, btnElement, filePath = null) {
    // Stub for future cloud analysis
    // User requested to remove local analysis for now
    alert("Cloud Analysis (audioplus) coming soon!");
};

function openSummaryModal() {
    document.getElementById('summary-modal').classList.remove('hidden');
}

window.closeSummaryModal = function () {
    document.getElementById('summary-modal').classList.add('hidden');
};

window.copySummary = function () {
    const content = document.getElementById('summary-content').innerText;
    navigator.clipboard.writeText(content).then(() => {
        const btn = document.querySelector('#summary-modal .btn-secondary');
        const originalText = btn.innerText;
        btn.innerText = '✅ Copied!';
        setTimeout(() => btn.innerText = originalText, 2000);
    });
};

function formatMarkdown(text) {
    // Basic Markdown Formatting
    if (!text) return '';
    let html = text
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") // Escape HTML
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
        .replace(/\n/gim, '<br>');
    return html;
}




// --- Split Logic ---



// --- Init ---

function initActions() {
    const quickMergeBtn = document.getElementById('btn-quick-merge');
    if (quickMergeBtn) {
        quickMergeBtn.addEventListener('click', startQuickMerge);
    }

    const mergeBtn = document.getElementById('btn-start-merge');
    if (mergeBtn) {
        mergeBtn.addEventListener('click', startMerge);
    }
}

// --- Utils ---

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function updateProgress(type, percent, logs) {
    // Determine which button to update
    const btnId = 'btn-start-merge';
    const btn = document.getElementById(btnId);

    if (btn) {
        btn.innerHTML = `<span class="loading-spinner"></span> ${percent}%`;
    }
}

window.previewQuickMergeFile = function (path) {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.previewFile) {
        window.webkit.messageHandlers.previewFile.postMessage({ path: path });
    } else {
        console.log('Preview file (Space bar hack):', path);
    }
};

const DEFAULT_PROMPT = "请详细分析该会议音频的信息，并按照将会议信息详细列出，包含总体会议目标，关键结论概括，按内容进行模块划分，并模块内注重关键结论的同步，最终附带后续的行动建议";

window.toggleFileActive = function (path) {
    if (state.activeFilePath === path) {
        state.activeFilePath = null;
    } else {
        state.activeFilePath = path;
    }

    // Re-render based on current view
    if (state.currentTab === 'projects') {
        const detailTitle = document.getElementById('project-detail-title');
        if (detailTitle && detailTitle.dataset.id) {
            const project = state.projects.find(p => p.id === detailTitle.dataset.id);
            if (project) renderProjectDetailFiles(project);
        }
    } else if (state.currentTab === 'quick-merge') {
        renderQuickMergeFiles();
    }

    // If search results are currently active, re-render them to show the active file actions
    const searchTab = document.getElementById('search-results-tab');
    if (searchTab && searchTab.classList.contains('active')) {
        const input = document.getElementById('global-search');
        if (input && input.value) {
            window.handleSearch(input.value);
        }
    }
};

window.shareToIMA = function (path) {
    // Find the file in state to see if it has an extracted audio path
    const file = state.quickMerge.files.find(f => f.path === path);
    const targetPath = (file && file.extracted_audio_path) ? file.extracted_audio_path : path;

    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.shareToIMA) {
        window.webkit.messageHandlers.shareToIMA.postMessage({
            path: targetPath,
            prompt: DEFAULT_PROMPT
        });
    } else {
        console.log('Sharing to IMA (Simulator):', targetPath);
    }
};

window.shareToChatGPT = function (path) {
    // Find the file in state to see if it has an extracted audio path
    const file = state.quickMerge.files.find(f => f.path === path);
    const targetPath = (file && file.extracted_audio_path) ? file.extracted_audio_path : path;

    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.shareToChatGPT) {
        window.webkit.messageHandlers.shareToChatGPT.postMessage({
            path: targetPath,
            prompt: DEFAULT_PROMPT
        });
    } else {
        console.log('Sharing to ChatGPT (Simulator):', targetPath);
    }
};




// --- Projects Feature Logic ---

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

window.createNewProject = function () {
    state.projectActionTargetId = null; // New project mode
    const modal = document.getElementById('create-project-modal');
    const title = modal.querySelector('h3');
    const inputContainer = document.getElementById('new-project-name').parentElement;
    const input = document.getElementById('new-project-name');
    const list = document.getElementById('create-project-file-list');

    title.innerHTML = '📂 New Project';
    inputContainer.style.display = 'block';

    // Reset fields
    input.value = '';
    list.innerHTML = '';

    // Populate files
    renderProjectModalFileList(list);

    modal.classList.add('active');
    input.focus();
};


function renderProjectModalFileList(containerEl, existingFiles = []) {
    if (state.quickMerge.files && state.quickMerge.files.length > 0) {
        state.quickMerge.files.forEach((file, index) => {
            const isAlreadyIn = existingFiles.includes(file.path);

            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.gap = '10px';
            div.style.padding = '6px';
            div.style.borderBottom = '1px solid #f3f4f6';

            const ext = file.name.split('.').pop().toLowerCase();
            const isDoc = ['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext);
            const icon = isDoc ? '📄' : '🎵';

            div.innerHTML = `
                <input type="checkbox" id="cp-file-${index}" value="${file.path.replace(/"/g, '&quot;')}" style="cursor:pointer;" ${isAlreadyIn ? 'checked disabled' : ''}>
                <label for="cp-file-${index}" style="cursor:pointer; font-size:0.9rem; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; ${isAlreadyIn ? 'color: #999;' : ''}">
                    <span style="margin-right:6px; opacity:0.8;">${icon}</span>
                    ${file.name} ${isAlreadyIn ? '(Already in project)' : ''}
                </label>
             `;
            containerEl.appendChild(div);
        });
    } else {
        containerEl.innerHTML = '<p class="text-gray-500" style="padding:10px;">No recordings found.</p>';
    }
}

window.openAddFilesModal = function () {
    const titleEl = document.getElementById('project-detail-title');
    const targetId = titleEl ? titleEl.dataset.id : null;

    if (!targetId) {
        alert("Please open a project first.");
        return;
    }

    state.projectActionTargetId = targetId;
    state.nextUploadType = 'project-docs';

    // Trigger native file picker
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.filePicker) {
        window.webkit.messageHandlers.filePicker.postMessage({ multiple: true });
    } else {
        alert("File picker is only available in the Mac app.");
        state.nextUploadType = null; // Reset
    }
};

window.triggerImport = function () {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.importFiles) {
        // Prepare known directories
        const knownDirs = [...state.quickMerge.directories];
        if (window.recordPath && !knownDirs.includes(window.recordPath)) {
            knownDirs.push(window.recordPath);
        }

        window.webkit.messageHandlers.importFiles.postMessage({
            directories: knownDirs
        });
    } else {
        alert("Import not supported in this environment (requires Mac App v2.0.4+).");
    }
};

window.onImportFinished = function (importedCount, skippedCount) {
    let msg = [];
    if (importedCount > 0) msg.push(`Successfully imported ${importedCount} file(s).`);
    if (skippedCount > 0) msg.push(`Skipped ${skippedCount} file(s) as they already exist in your folders.`);

    if (msg.length > 0) {
        showAlert(msg.join('\n'), importedCount > 0 ? 'success' : 'warning');
        if (importedCount > 0) {
            loadAllFiles();
        }
    }
};

window.startRealMeeting = function () {
    showAlert('Real-time Meeting functionality is coming soon!', 'info');
};

window.closeCreateProjectModal = function () {
    document.getElementById('create-project-modal').classList.remove('active');
};

window.submitCreateProject = function () {
    const targetId = state.projectActionTargetId;

    let targetProject = null;
    if (targetId) {
        targetProject = state.projects.find(p => p.id === targetId);
    }

    const nameInput = document.getElementById('new-project-name');
    const name = nameInput.value;

    if (!targetProject && (!name || name.trim() === '')) {
        alert('Please enter a project name');
        return;
    }

    // Collect selected files
    const selectedPaths = [];
    const checkboxes = document.querySelectorAll('#create-project-file-list input[type="checkbox"]:checked:not(:disabled)');
    checkboxes.forEach(cb => {
        selectedPaths.push(cb.value);
    });

    if (targetProject) {
        // Add to existing
        selectedPaths.forEach(path => {
            if (!targetProject.files.includes(path)) {
                targetProject.files.push(path);
            }
        });
        savePersistentData();
        renderProjectDetailFiles(targetProject);
    } else {
        // Create new
        const newProject = {
            id: generateUUID(),
            name: name.trim(),
            createdAt: new Date().toISOString(),
            files: selectedPaths
        };
        state.projects.push(newProject);
        savePersistentData();
    }

    closeCreateProjectModal();
    renderProjectsGrid();

    if (selectedPaths.length > 0) {
        renderQuickMergeFiles();
    }
};

window.startRenameProject = function (id, currentName) {
    const newName = prompt("Enter new project name:", currentName);
    if (newName && newName.trim() !== "" && newName !== currentName) {
        const project = state.projects.find(p => p.id === id);
        if (project) {
            project.name = newName.trim();
            savePersistentData();
            renderProjectsGrid();

            // Update title if in detail view
            const titleEl = document.getElementById('project-detail-title');
            if (titleEl && titleEl.dataset.id === id) {
                titleEl.textContent = project.name;
            }
        }
    }
};

window.deleteProject = function (id) {
    if (!confirm("Are you sure you want to delete this project? Recordings will NOT be deleted.")) return;

    state.projects = state.projects.filter(p => p.id !== id);
    savePersistentData();
    renderProjectsGrid();

    // If we are in detail view for this project, close it
    const detailView = document.getElementById('project-detail-view');
    if (!detailView.classList.contains('hidden')) {
        closeProjectDetail();
    }
};

window.triggerProjectRename = function () {
    const titleEl = document.getElementById('project-detail-title');
    if (!titleEl) return;

    // Prevent double activation
    if (titleEl.querySelector('input')) return;

    const id = titleEl.dataset.id;
    const currentName = titleEl.textContent;

    // Create input element
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.style.fontSize = 'inherit';
    input.style.fontWeight = '600';
    input.style.color = 'var(--text-primary)';
    input.style.background = '#fff';
    input.style.border = '1px solid var(--primary-color)';
    input.style.borderRadius = '6px';
    input.style.padding = '4px 8px';
    input.style.minWidth = '200px';
    input.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';

    // Replace text with input
    titleEl.textContent = '';
    titleEl.appendChild(input);
    input.focus();
    input.select();

    // Clean up function to restore text
    const finish = (shouldSave) => {
        const newName = input.value.trim();
        if (shouldSave && newName && newName !== "") {
            // Save if changed
            if (newName !== currentName) {
                const project = state.projects.find(p => p.id === id);
                if (project) {
                    project.name = newName;
                    savePersistentData();
                    renderProjectsGrid();
                }
            }
            titleEl.textContent = newName;
        } else {
            // Revert
            titleEl.textContent = currentName;
        }
    };

    // Events
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            input.blur(); // This will trigger the blur handler which executes finish(true)
            e.preventDefault();
        } else if (e.key === 'Escape') {
            // Remove blur listener to avoid double call (though implementation handles idleness)
            // But easier to just force revert
            input.value = currentName;
            input.blur();
        }
    });

    // Stop propagation to prevent bubbling to parent click handlers if any
    input.addEventListener('click', (e) => e.stopPropagation());
};

window.triggerProjectDelete = function () {
    const titleEl = document.getElementById('project-detail-title');
    const id = titleEl ? titleEl.dataset.id : null;
    if (id) {
        deleteProject(id);
    }
};

window.renderProjectsGrid = function () {
    const grid = document.getElementById('projects-grid');
    if (!grid) return;

    grid.innerHTML = '';

    if (!state.projects || state.projects.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">No projects yet. Create one to get started!</div>';
        return;
    }

    state.projects.forEach(project => {
        const card = document.createElement('div');
        card.className = 'project-card';
        card.onclick = () => openProject(project.id);

        const count = project.files ? project.files.length : 0;

        card.innerHTML = `
            <div class="project-thumb">
                📂
            </div>
            <div class="project-info">
                <div class="project-name" title="${project.name}">${project.name}</div>
                <div class="project-count">${count} Recording${count !== 1 ? 's' : ''}</div>
            </div>
        `;
        grid.appendChild(card);
    });
};

window.openProject = function (id) {
    const project = state.projects.find(p => p.id === id);
    if (!project) return;

    document.getElementById('projects-list-header').classList.add('hidden');
    document.getElementById('projects-subtitle').classList.add('hidden');
    document.getElementById('projects-grid').classList.add('hidden');
    document.getElementById('project-detail-view').classList.remove('hidden');
    document.getElementById('project-detail-title').textContent = project.name;
    document.getElementById('project-detail-title').dataset.id = id;

    renderProjectDetailFiles(project);
};

window.closeProjectDetail = function () {
    document.getElementById('project-detail-view').classList.add('hidden');
    document.getElementById('projects-list-header').classList.remove('hidden');
    document.getElementById('projects-subtitle').classList.remove('hidden');
    document.getElementById('projects-grid').classList.remove('hidden');
    renderProjectsGrid();
};

function renderProjectDetailFiles(project) {
    const container = document.getElementById('project-file-list');
    container.innerHTML = '';

    if (!project.files || project.files.length === 0) {
        container.innerHTML = '<p class="empty-state">No files in this project.</p>';
        return;
    }

    // --- Timeline Logic for Project Files ---
    const allFiles = project.files.map(path => {
        // Look in persistent project metadata first
        const persistentMeta = project.filesMetadata ? project.filesMetadata[path] : null;
        if (persistentMeta) return persistentMeta;

        // Then look in global session state
        const sessFile = state.quickMerge.files.find(f => f.path === path);
        if (sessFile) return sessFile;

        // Fallback for missing file metadata
        return {
            path: path,
            name: path.split('/').pop(),
            size: 0,
            mtime: Math.floor(Date.now() / 1000),
            birthtime: Math.floor(Date.now() / 1000),
            _isFallback: true
        };
    });

    // Sort by mtime descending
    allFiles.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

    const formatDate = (timestamp) => {
        if (!timestamp) return 'Unknown Date';
        const date = new Date(timestamp * 1000);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - (24 * 60 * 60 * 1000);

    // Group files by date
    const groupsMap = new Map();
    allFiles.forEach(file => {
        const fileTime = file.mtime ? file.mtime * 1000 : 0;
        const dayStart = fileTime ? new Date(new Date(fileTime).getFullYear(), new Date(fileTime).getMonth(), new Date(fileTime).getDate()).getTime() : 0;

        const formattedDate = formatDate(file.mtime);
        let label = (dayStart === todayStart) ? `Today (${formattedDate})` :
            (dayStart === yesterdayStart) ? `Yesterday (${formattedDate})` : formattedDate;

        if (!groupsMap.has(dayStart)) {
            groupsMap.set(dayStart, { label, files: [] });
        }
        groupsMap.get(dayStart).files.push(file);
    });

    const sortedStarts = Array.from(groupsMap.keys()).sort((a, b) => b - a);

    sortedStarts.forEach(start => {
        const group = groupsMap.get(start);
        const header = document.createElement('div');
        header.className = 'timeline-header';
        header.textContent = group.label;
        container.appendChild(header);

        group.files.forEach(file => {
            if (!file._isFallback) {
                const html = renderFileItemHTML(file, file._originalIndex, {
                    showProjectTag: false,
                    showCheckbox: false,
                    showRemoveButton: true,
                    projectId: project.id
                });
                container.appendChild(html);
            } else {
                const div = document.createElement('div');
                div.className = 'file-item';
                const ext = file.name.split('.').pop().toLowerCase();
                const isDoc = ['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext);
                const icon = isDoc ? '📄' : '🎵';

                div.innerHTML = `
                    <div class="file-item-content">
                        <div class="file-main">
                            <div class="file-info">
                                <div class="file-name">
                                    <span style="margin-right:8px;">${icon}</span>
                                    <span>${file.name} (Meta N/A)</span>
                                </div>
                            </div>
                            <div class="file-actions">
                                <button class="btn-link" onclick="event.preventDefault(); event.stopPropagation(); removeFileFromProject('${file.path.replace(/'/g, "\\'")}', '${project.id}')">Remove</button>
                            </div>
                        </div>
                    </div>`;
                container.appendChild(div);
            }
        });
    });
}

/**
 * Universal file item renderer
 */
function renderFileItemHTML(file, index, options = {}) {
    const isSelected = options.isQuickMerge ? state.quickMerge.selectedFiles.includes(index) : false;
    const selectionOrder = isSelected ? state.quickMerge.selectedFiles.indexOf(index) + 1 : 0;
    const isEditing = state.quickMerge.editingFileIndex === index;
    // Merge simulated metadata if available
    const simMeta = state.simulatedMetadata[file.path];
    if (simMeta) {
        // Merge simulated props into file object for rendering
        file = { ...file, ...simMeta };
        // Ensure linkedDocuments are merged
        if (simMeta.linkedDocuments) file.linkedDocuments = simMeta.linkedDocuments;
    }

    const summary = state.quickMerge.linkedSummaries[file.path];
    const isHighlighted = state.quickMerge.highlightPath === file.path;

    const isActive = state.activeFilePath === file.path;

    const el = document.createElement(options.showCheckbox ? 'label' : 'div');
    el.className = 'file-item' + (isSelected ? ' selected' : '') + (isHighlighted ? ' highlight-new' : '') + (isActive ? ' active' : '');

    // Toggle active state on click
    if (!isEditing) {
        el.onclick = (e) => {
            // Don't toggle if clicking on specific buttons or links
            if (e.target.closest('.btn-locate, .btn-rename, .btn-rename-trigger, .btn-preview-mini, .extracted-audio-link, .generate-dropdown, .file-action-bar, input[type="checkbox"]')) {
                return;
            }
            window.toggleFileActive(file.path);
        };
    }

    const ext = file.name.split('.').pop().toLowerCase();
    const isAudio = ['mp3', 'm4a', 'm4b', 'aac', 'ogg', 'flac', 'wav', 'wma', 'opus'].includes(ext);
    const isDoc = ['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext);
    const isVideo = file.is_video;
    const fileIcon = isDoc ? '📄' : (isVideo ? '🎬' : (isAudio ? '🎵' : '📁'));

    // Only show icon in Project view, not in Quick Merge (Recordings)
    const showIcon = !options.isQuickMerge;

    let nameContent = `
        <div class="file-name">
            ${showIcon ? `<span style="margin-right:8px; font-size: 1.1em; opacity: 0.8;">${fileIcon}</span>` : ''}
            <span>${file.name}</span>
            ${(isAudio && (file.birthtime || file.mtime)) ? (function () {
            let startTimeTs;
            if (file.birthtime) {
                startTimeTs = file.birthtime * 1000;
            } else {
                startTimeTs = (file.mtime - (file.duration || 0)) * 1000;
            }
            const startDate = new Date(startTimeTs);
            const hh = startDate.getHours().toString().padStart(2, '0');
            const mm = startDate.getMinutes().toString().padStart(2, '0');
            return `<span style="margin-left:8px; font-size: 0.8rem; color: #94a3b8; font-weight: normal;">recording from ${hh}:${mm}</span>`;
        })() : ''}
            <span class="btn-locate" title="Reveal in Finder" onclick="event.preventDefault(); event.stopPropagation(); window.webkit?.messageHandlers?.openDirectory?.postMessage({ path: '${file.path.replace(/'/g, "\\'")}' })">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </span>
            <span class="btn-rename" onclick="event.preventDefault(); event.stopPropagation(); startQuickMergeRename(${index})">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </span>
        </div>
    `;

    if (isEditing) {
        nameContent = `
            <div class="file-name">
                <input type="text" class="rename-input" id="rename-input-${index}" 
                       value="${file.name.substring(0, file.name.lastIndexOf('.')) || file.name}" 
                       onclick="event.preventDefault(); event.stopPropagation();">
            </div>
        `;
    }

    el.innerHTML = `
        ${options.showCheckbox ? `
            <input type="checkbox" 
                id="qm-file-${index}" 
                ${isSelected ? 'checked' : ''}
                ${isEditing ? 'disabled' : ''}
                onchange="toggleQuickMergeFile(${index})">
        ` : ''}
        <div class="file-item-content">
            <div class="file-main">
                <div class="file-info">
                    ${nameContent}
                    <div class="file-meta">
                        ${file.size ? formatSize(file.size) + ' • ' : ''} ${file.durationStr || 'N/A'}
                        ${file.is_extracting ? '<span class="loading-spinner-mini" title="Extracting audio..."></span>' : ''}
                        ${file.extracted_audio_path ? `
                            <span class="extracted-audio-link" onclick="event.preventDefault(); event.stopPropagation(); window.previewQuickMergeFile('${file.extracted_audio_path.replace(/'/g, "\\'")}')">
                                🎵 Audio Extracted
                            </span>
                        ` : ''}
                        <span class="btn-preview-mini" title="Quick Preview" onclick="event.preventDefault(); event.stopPropagation(); window.previewQuickMergeFile('${file.path.replace(/'/g, "\\'")}')">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        </span>
                        ${options.showProjectTag ? renderProjectTag(file.path, index) : ''}
                        ${file.linkedDocuments && file.linkedDocuments.length > 0 ? `
                            <span style="display:inline-flex; align-items:center; margin-left:8px; color:#666; font-size:0.85em;">
                                <span style="margin-right:4px;">📎</span>
                                ${file.linkedDocuments.map(d => `<span title="${d.name}" style="margin-right:4px; border-bottom:1px dashed #ccc;">${d.name}</span>`).join(', ')}
                            </span>
                        ` : ''}
                    </div>
                </div>
                    <div class="generate-label">
                        <button class="btn-details" style="padding-right:12px; cursor: default; display: flex; justify-content: center; align-items: center; width: 100px;" 
                            onclick="event.preventDefault(); event.stopPropagation(); simulateSmartProcessing('${file.path.replace(/'/g, "\\'")}', ${index})">
                            Generate ${state.quickMerge.processingFileIndex === index ? '<span class="loading-spinner-mini" style="margin-left: 6px;"></span>' : ''}
                        </button>
                    </div>
                </div>
            ${isActive ? `
                <div class="file-action-bar">
                    <button class="tape-btn" onclick="event.preventDefault(); event.stopPropagation(); window.analyzeAudio(null, this, '${file.path.replace(/'/g, "\\'")}')">
                        <span class="tape-icon">✨</span>
                        <span class="tape-label">Summary</span>
                    </button>
                    <button class="tape-btn" onclick="event.preventDefault(); event.stopPropagation(); window.shareToIMA('${file.path.replace(/'/g, "\\'")}')">
                        <span class="tape-icon">🚀</span>
                        <span class="tape-label">IMA</span>
                    </button>
                    <button class="tape-btn" onclick="event.preventDefault(); event.stopPropagation(); window.shareToChatGPT('${file.path.replace(/'/g, "\\'")}')">
                        <span class="tape-icon">💬</span>
                        <span class="tape-label">ChatGPT</span>
                    </button>
                    <button class="tape-btn" onclick="event.preventDefault(); event.stopPropagation(); linkQuickMergeFile(${index})">
                        <span class="tape-icon">📎</span>
                        <span class="tape-label">Memo</span>
                    </button>
                </div>
            ` : ''}
            ${(summary || file.ai_summary) ? `
                <div class="file-summary" style="color: var(--text-secondary);">
                    <div class="summary-text" style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div style="flex: 1; font-size: 0.85rem; line-height: 1.4;">
                            ${file.ai_summary ? `✨ ${file.ai_summary}` : (summary.text || summary)}...
                        </div>
                        <div style="display: flex; gap: 8px; margin-left: 12px; white-space: nowrap;">
                            <button class="btn-link" style="font-size: 11px; padding: 2px 6px; color: #666; border-color: #eee;" 
                                onclick="event.preventDefault(); event.stopPropagation(); window.analyzeAudio(null, this, '${file.path.replace(/'/g, "\\'")}')">
                                View Details
                            </button>
                            ${!file.ai_summary ? `
                                <span style="cursor:pointer; color:#999; font-size:12px;" 
                                    onclick="event.preventDefault(); event.stopPropagation(); clearQuickMergeLink(${index})">
                                    [remove]
                                </span>
                            ` : ''}
                        </div>
                    </div>
                </div>
            ` : ''}
        </div>
    `;

    if (isEditing) {
        // Need to wait for DOM attachment? Usually this is called then appended.
        // We'll handle input focus after append in the caller or use a timeout here if desperate.
        setTimeout(() => {
            const input = document.getElementById(`rename-input-${index}`);
            if (input) {
                input.focus();
                input.select();
                attachRenameListeners(input, index);
            }
        }, 0);
    }
    return el;
}

function attachRenameListeners(input, index) {
    let isComposing = false;
    input.addEventListener('compositionstart', () => { isComposing = true; });
    input.addEventListener('compositionend', () => { isComposing = false; });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !isComposing) input.blur();
        if (e.key === 'Escape') cancelQuickMergeRename();
    });
    input.addEventListener('blur', () => {
        setTimeout(() => saveQuickMergeRename(index, input.value), 50);
    });
}

window.removeFileFromProject = function (path, projectId) {
    const project = state.projects.find(p => p.id === projectId);
    if (project) {
        project.files = project.files.filter(f => f !== path);
        savePersistentData();
        renderProjectDetailFiles(project);
        renderProjectsGrid(); // Update count
    }
};

window.addFileToProject = function (path, projectId) {
    const project = state.projects.find(p => p.id === projectId);
    if (project) {
        if (!project.files.includes(path)) {
            project.files.push(path);
            savePersistentData();
            renderProjectsGrid();
            renderQuickMergeFiles(); // Refresh list to show tag
            toggleGenerateDropdown('null'); // Close dropdowns
        }
    }
};

// Helper to render the Project Tag/Dropdown in the main file list
function renderProjectTag(path, index) {
    const project = state.projects ? state.projects.find(p => p.files && p.files.includes(path)) : null;

    const escapedPath = path.replace(/'/g, "\\'");

    if (project) {
        return `
            <span class="project-tag" onclick="event.preventDefault(); event.stopPropagation(); toggleProjectDropdown(${index})">
                📂 ${project.name}
            </span>
            ${renderProjectDropdown(index, escapedPath)}
        `;
    } else {
        return `
            <span class="project-tag empty" title="Add to Project" onclick="event.preventDefault(); event.stopPropagation(); toggleProjectDropdown(${index})">
                + Project
            </span>
            ${renderProjectDropdown(index, escapedPath)}
        `;
    }
}

function renderProjectDropdown(index, path) {
    let itemsHtml = '';

    if (!state.projects || state.projects.length === 0) {
        itemsHtml = `<div class="dropdown-item" onclick="event.stopPropagation(); createNewProject()">+ New Project...</div>`;
    } else {
        state.projects.forEach(p => {
            const isAssigned = p.files && p.files.includes(path);
            const icon = isAssigned ? '✅' : '⬜';
            // Action logic handles escaping internally
            const action = isAssigned ? `removeFileFromProject('${path}', '${p.id}'); renderQuickMergeFiles();` : `addFileToProject('${path}', '${p.id}')`;

            itemsHtml += `
                <div class="dropdown-item" onclick="event.stopPropagation(); ${action}">
                    <span>${icon}</span> ${p.name}
                </div>
             `;
        });
        itemsHtml += `<div style="border-top:1px solid #eee; margin:4px 0;"></div>`;
        itemsHtml += `<div class="dropdown-item" onclick="event.stopPropagation(); createNewProject()">+ New Project...</div>`;
    }

    return `
        <div class="generate-dropdown" id="project-dropdown-${index}" style="display:inline-block; width:0; height:0; overflow:visible;">
            <div class="dropdown-menu project-select-menu">
                ${itemsHtml}
            </div>
        </div>
    `;
}

// --- Smart Meeting Processing Simulation ---

window.simulateSmartProcessing = async function (path, index) {
    // Find the button again to update UI
    // Path includes escaped quotes in onclick, but we can target by closest file-item or just assume index is correct
    // But since list might re-render, safer to find by path if we had unique IDs.
    // However, the button element wasn't passed directly. Let's try to find it.
    // For now we will rely on re-rendering to show state, but initially we want immediate feedback.

    // We need to find the specific button to show loading
    // Since we don't have a unique ID for the button easily, let's use a query selector based on the onclick attribute or path
    // Escaping path for selector is tricky. Let's try to update state and re-render the specific item if possible, or just global reload.
    // Better: let's assume the button passed 'this' if we change the call signature. 
    // But for now, let's just show a global alert or use a simple hack to find button.

    const allBtns = document.querySelectorAll('.generate-label button');
    // This is hard to match exactly without unique ID.
    // Let's just set a flag in state and re-render.

    state.quickMerge.processingFileIndex = index;
    renderQuickMergeFiles(); // This will show spinner if we update render logic

    // simulation data
    const mockData = {
        newName: "Project Check-in Meeting",
        projectName: "Project Alpha",
        docs: [
            { name: "Meeting Minutes.md", type: "md" },
            { name: "Action Items.txt", type: "txt" }
        ],
        calendar: {
            title: "Project Check-in Meeting",
            notes: "Discussed Q1 goals and roadmap. consensus reached on timeline."
        }
    };

    try {
        // Step 1: Simulate Analysis Delay
        await new Promise(r => setTimeout(r, 1500));

        // Step 2: Rename File
        const file = state.quickMerge.files[index];
        if (!file) throw new Error("File not found");

        const oldPath = file.path;
        const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/'));
        const ext = file.name.split('.').pop();
        const newName = `${mockData.newName}.${ext}`;
        const newPath = `${parentDir}/${newName}`;

        // Only rename if different
        if (file.name !== newName && file.name !== newName) {
            // In simulation we might just overwrite or check if exists.
            // Let's try to rename.
            await fetch(`${API_BASE}?action=rename_file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ old_path: oldPath, new_path: newPath })
            });
            file.name = newName;
            file.path = newPath;
        }

        // Step 3: Categorize (Mock Project)
        let project = state.projects.find(p => p.name === mockData.projectName);
        if (!project) {
            const newProj = {
                id: 'proj_' + Date.now(),
                name: mockData.projectName,
                createdAt: new Date().toISOString(),
                files: []
            };
            state.projects.push(newProj);
            project = newProj;
        }
        if (!project.files.includes(newPath)) {
            project.files.push(newPath);
            savePersistentData();
        }

        // Step 4: Generate Mock Documents
        // Allow rendering these in the file item
        if (!file.linkedDocuments) file.linkedDocuments = [];
        mockData.docs.forEach(d => {
            if (!file.linkedDocuments.find(ld => ld.name === d.name)) {
                file.linkedDocuments.push(d);
            }
        });

        // Persist simulated outcome
        // We use the NEW path as key because file is renamed.
        state.simulatedMetadata[newPath] = {
            ...mockData,
            linkedDocuments: mockData.docs, // Ensure checking correct prop
            name: newName,
            path: newPath
        };
        // Clean up old path meta if any
        if (oldPath !== newPath && state.simulatedMetadata[oldPath]) {
            delete state.simulatedMetadata[oldPath];
        }

        savePersistentData();

        // Step 5: Update UI State BEFORE alerting
        state.quickMerge.processingFileIndex = null;

        // Optimistically update the file item in array so render shows changes immediately
        state.quickMerge.files[index] = {
            ...file,
            name: newName,
            path: newPath,
            linkedDocuments: mockData.docs
        };

        renderQuickMergeFiles();

        // Step 6: Calendar Event (Async)
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.createCalendarEvent) {
            // Small delay to ensure UI rendered
            setTimeout(() => {
                window.webkit.messageHandlers.createCalendarEvent.postMessage({
                    title: mockData.calendar.title,
                    startDate: new Date().getTime() / 1000,
                    duration: 3600,
                    notes: mockData.calendar.notes
                });
            }, 100);
        }

        // Delay success alert slightly so user sees the change first
        setTimeout(() => {
            // loadAllFiles to confirm disk state, but our optimistic update holds the fort
            loadAllFiles();
            // We don't show alert here to avoid blocking, the Calendar prompt is enough feedback?
            // Or show a non-blocking toast. For now, skip alert or use small timeout.
        }, 500);

    } catch (err) {
        console.error("Smart processing failed:", err);
        showAlert("Analysis failed", "danger");
        state.quickMerge.processingFileIndex = null;
        renderQuickMergeFiles();
    }
};

window.toggleProjectDropdown = function (index) {
    // Close others including generate dropdowns
    document.querySelectorAll('.generate-dropdown.active').forEach(el => el.classList.remove('active'));

    const dd = document.getElementById(`project-dropdown-${index}`);
    if (dd) {
        dd.classList.add('active');
    }
};

// Global callback for native app
window.selectedFilesCallback = function (files) {
    window.handleNativeUpload(files);
};

// --- Global Search Logic ---

window.handleSearch = function (query) {
    if (!query || query.trim() === "") {
        window.closeSearch();
        return;
    }

    const q = query.toLowerCase().trim();
    console.log('Searching for:', q);

    const results = {
        projects: [],
        recordings: [],
        documents: []
    };

    // 1. Search Projects
    if (state.projects) {
        results.projects = state.projects.filter(p => p.name.toLowerCase().includes(q));
    }

    // 2. Search Recordings (Audio)
    if (state.quickMerge.files) {
        results.recordings = state.quickMerge.files.filter(f => f.name.toLowerCase().includes(q));
    }

    // 3. Search Documents
    if (state.documents.files) {
        results.documents = state.documents.files.filter(f => f.name.toLowerCase().includes(q));
    }

    renderSearchResults(results, q);
};

function renderSearchResults(results, query) {
    const container = document.getElementById('search-results-container');
    if (!container) return;

    container.innerHTML = '';
    const totalHits = results.projects.length + results.recordings.length + results.documents.length;

    if (totalHits === 0) {
        container.innerHTML = `<p class="empty-state">No matches found for "${query}"</p>`;
    } else {
        // Render Projects
        if (results.projects.length > 0) {
            const title = document.createElement('div');
            title.className = 'search-group-title';
            title.innerHTML = `📂 Projects (${results.projects.length})`;
            container.appendChild(title);

            results.projects.forEach(project => {
                const el = document.createElement('div');
                el.className = 'file-item';
                el.onclick = () => {
                    window.closeSearch();
                    // Open project detail
                    const card = document.querySelector(`.project-card[onclick*="${project.id}"]`);
                    if (card) card.click();
                    else {
                        // Manual activation if card not found
                        state.currentTab = 'projects';
                        const tabs = document.querySelectorAll('.nav-tab');
                        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'projects'));
                        document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'projects-tab'));
                        // @ts-ignore
                        if (window.openProjectDetail) window.openProjectDetail(project.id);
                    }
                };

                el.innerHTML = `
                    <div class="file-item-content">
                        <div class="file-main">
                            <div class="file-info">
                                <div class="file-name">📂 ${highlightText(project.name, query)}</div>
                                <div class="file-meta">Created ${new Date(project.createdAt).toLocaleDateString()}</div>
                            </div>
                        </div>
                    </div>
                `;
                container.appendChild(el);
            });
        }

        // Render Recordings
        if (results.recordings.length > 0) {
            const title = document.createElement('div');
            title.className = 'search-group-title';
            title.innerHTML = `🎙️ Recordings (${results.recordings.length})`;
            container.appendChild(title);

            results.recordings.forEach(file => {
                const el = renderFileItemHTML(file, state.quickMerge.files.indexOf(file), {
                    isQuickMerge: true,
                    showCheckbox: false,
                    showProjectTag: true
                });

                // Highlight name
                const nameSpan = el.querySelector('.file-name span');
                if (nameSpan) nameSpan.innerHTML = highlightText(file.name, query);

                container.appendChild(el);
            });
        }

        // Render Documents
        if (results.documents.length > 0) {
            const title = document.createElement('div');
            title.className = 'search-group-title';
            title.innerHTML = `📄 Documents (${results.documents.length})`;
            container.appendChild(title);

            results.documents.forEach(file => {
                const el = renderFileItemHTML(file, state.documents.files.indexOf(file), {
                    isQuickMerge: false,
                    showCheckbox: false
                });

                // Highlight name
                const nameSpan = el.querySelector('.file-name span');
                if (nameSpan) nameSpan.innerHTML = highlightText(file.name, query);

                container.appendChild(el);
            });
        }
    }

    // Switch to search results tab
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('search-results-tab').classList.add('active');
    // Deactivate nav tabs
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
}

function highlightText(text, query) {
    if (!query) return text;
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<span class="search-highlight">$1</span>');
}

window.closeSearch = function () {
    const input = document.getElementById('global-search');
    if (input) input.value = '';

    // Hide clear button
    const clearBtn = document.getElementById('search-clear');
    if (clearBtn) clearBtn.classList.add('hidden');

    // Return to the tab that was active before search
    const targetTab = state.currentTab || 'projects';
    const tabBtn = document.querySelector(`.nav-tab[data-tab="${targetTab}"]`);
    if (tabBtn) {
        tabBtn.click();
    } else {
        // Fallback
        const defaultBtn = document.querySelector('.nav-tab[data-tab="projects"]');
        if (defaultBtn) defaultBtn.click();
    }

    document.getElementById('search-results-tab').classList.remove('active');
};
