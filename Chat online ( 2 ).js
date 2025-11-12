<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Front Maritim Chat Online</title>
    <!-- Tailwind CSS CDN -->
    <script src="https://cdn.tailwindcss.com"></script>
    <!-- Inter Font -->
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap');
        body {
            font-family: 'Inter', sans-serif;
            background-color: #f0f4f8;
        }
        .chat-container {
            max-height: calc(100vh - 200px);
            overflow-y: auto;
            scroll-behavior: smooth;
        }
    </style>

    <!-- INICIO: Manifest PWA para hacer la web instalable como una aplicación -->
    <link rel="manifest" href="data:application/manifest+json,%7B%22name%22%3A%22Front%20Maritim%20Chat%22%2C%22short_name%22%3A%22ChatFM%22%2C%22description%22%3A%22Tu%20chat%20privado%20y%20seguro.%22%2C%22start_url%22%3A%22.%2F%22%2C%22display%22%3A%22standalone%22%2C%22background_color%22%3A%22%23f0f4f8%22%2C%22theme_color%22%3A%22%234f46e5%22%2C%22icons%22%3A%5B%7B%22src%22%3A%22https%3A%2F%2Fplacehold.co%2F192x192%2F4f46e5%2Fffffff%3Ftext%3DFM%22%2C%22sizes%22%3A%22192x192%22%2C%22type%22%3A%22image%2Fpng%22%7D%2C%7B%22src%22%3A%22https%3A%2F%2Fplacehold.co%2F512x512%2F4f46e5%2Fffffff%3Ftext%3DFM%22%2C%22sizes%22%3A%22512x512%22%2C%22type%22%3A%22image%2Fpng%22%7D%5D%7D">
    <!-- FIN: Manifest PWA -->

</head>
<body class="min-h-screen flex items-center justify-center p-4">

    <!-- Main Application Container -->
    <div id="app" class="w-full max-w-4xl bg-white shadow-2xl rounded-xl overflow-hidden min-h-[600px] flex flex-col md:flex-row">
        <!-- Content will be rendered here by JavaScript -->
    </div>

    <!-- Firebase Imports (Required for all Firestore apps) -->
    <script type="module">
        import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        // AÑADIDO getDocs aquí para resolver el ReferenceError
        import { getFirestore, doc, setDoc, getDoc, collection, query, where, onSnapshot, updateDoc, arrayUnion, arrayRemove, runTransaction, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
        import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

        // Global variables provided by the environment (MANDATORY USE)
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-chat-app-id';
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
        const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

        // Initialize Firebase services
        let app;
        let db;
        let auth;
        let unsubscribeListeners = [];

        // Global State
        const state = {
            currentPage: 'verification', // 'verification', 'register', 'login', 'dashboard'
            isAuthReady: false,
            userId: null,
            displayName: null,
            friends: [], // [{id, name, chatId}]
            selectedFriend: null, // {id, name, chatId}
            messages: [],
            verificationCode: 'frontmaritimchatonline',
            isChatLoading: false,
        };

        // Utility: Render function to update the entire UI based on state.currentPage
        const render = () => {
            const appElement = document.getElementById('app');
            if (!appElement) return;
            appElement.innerHTML = ''; // Clear existing content

            switch (state.currentPage) {
                case 'verification':
                    renderVerification(appElement);
                    break;
                case 'register':
                    renderAuthForm(appElement, 'register');
                    break;
                case 'login':
                    renderAuthForm(appElement, 'login');
                    break;
                case 'dashboard':
                    renderDashboard(appElement);
                    break;
                default:
                    appElement.innerHTML = `<div class="p-8 text-center w-full">Error de estado.</div>`;
            }
        };

        // --- AUTH & FIREBASE INITIALIZATION ---

        const initializeAppAndAuth = async () => {
            if (Object.keys(firebaseConfig).length === 0) {
                console.error("Firebase config is missing.");
                // Fallback for non-canvas environment (will break without external firebase setup)
                // state.isAuthReady = true;
                // state.userId = 'simulated-user';
                // state.displayName = 'Simulated User';
                // render();
                // return;
            }

            app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);
            setLogLevel('debug'); // Enable Firestore logs

            onAuthStateChanged(auth, async (user) => {
                if (user) {
                    state.userId = user.uid;
                    // Check if user profile exists (for displayName)
                    await loadUserProfile();
                } else {
                    state.userId = null;
                    state.displayName = null;
                }
                state.isAuthReady = true;
                // If the user has passed verification but not yet logged in/registered, stay there
                if (state.currentPage !== 'verification') {
                    if (state.displayName) {
                        state.currentPage = 'dashboard';
                        fetchFriends();
                    } else if (state.currentPage !== 'register' && state.currentPage !== 'login') {
                        // User is authenticated but profile is missing -> go to login/register to set up displayName
                        state.currentPage = 'login';
                    }
                }
                render();
            });

            // Sign in immediately using custom token or anonymously
            try {
                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (error) {
                console.error("Error during initial sign-in:", error);
            }
        };

        const generateChatId = (user1Id, user2Id) => {
            // Genera un ID de chat consistente ordenando los IDs de usuario.
            return [user1Id, user2Id].sort().join('_');
        };

        // --- USER PROFILE & FRIENDSHIP MANAGEMENT ---

        const getUserProfileRef = (userId) => {
            // Public collection to list all display names for searching
            return doc(db, 'artifacts', appId, 'public', 'data', 'user_profiles', userId);
        };

        const loadUserProfile = async () => {
            if (!state.userId) return false;
            try {
                const docSnap = await getDoc(getUserProfileRef(state.userId));
                if (docSnap.exists()) {
                    state.displayName = docSnap.data().displayName;
                    return true;
                }
                return false;
            } catch (error) {
                console.error("Error loading user profile:", error);
                return false;
            }
        };

        const saveUserProfile = async (displayName, password) => {
            if (!state.userId || !displayName) throw new Error("User ID or Display Name missing.");

            // Store profile publicly for lookup
            await setDoc(getUserProfileRef(state.userId), {
                userId: state.userId,
                displayName: displayName,
                searchName: displayName.toLowerCase(),
                // NOTE: Password stored only locally for simulation (NOT SECURE in a real app)
                passwordHash: password, // For simulation only
            });
            // Also store local simulation password (not persistent across sessions in this setup)
            localStorage.setItem(`chat_password_${state.userId}`, password);
            state.displayName = displayName;
        };

        const getFriendsCollectionRef = (userId) => {
            // Private collection for the user's friend list
            return doc(db, 'artifacts', appId, 'users', userId, 'friends', 'list');
        };

        const fetchFriends = () => {
            if (!state.userId) return;

            // Clear previous listeners
            unsubscribeListeners.forEach(unsub => unsub());
            unsubscribeListeners = [];

            const unsub = onSnapshot(getFriendsCollectionRef(state.userId), (docSnap) => {
                if (docSnap.exists() && docSnap.data().friends) {
                    state.friends = docSnap.data().friends.map(friend => ({
                        ...friend,
                        chatId: generateChatId(state.userId, friend.id)
                    }));
                } else {
                    state.friends = [];
                }
                // If a friend was selected but is no longer in the list, clear it
                if (state.selectedFriend && !state.friends.some(f => f.id === state.selectedFriend.id)) {
                    state.selectedFriend = null;
                }
                render();
                // If no friend is selected but friends exist, select the first one
                if (!state.selectedFriend && state.friends.length > 0) {
                     selectFriend(state.friends[0]);
                }
            }, (error) => {
                console.error("Error fetching friends:", error);
            });
            unsubscribeListeners.push(unsub);
        };

        const addFriendByDisplayName = async (friendDisplayName) => {
            if (!state.userId) return "Error: Usuario no autenticado.";

            const searchName = friendDisplayName.toLowerCase();
            if (searchName === state.displayName.toLowerCase()) {
                return "No puedes agregarte a ti mismo como amigo.";
            }

            try {
                // 1. Find the friend's profile
                const q = query(
                    collection(db, 'artifacts', appId, 'public', 'data', 'user_profiles'),
                    where('searchName', '==', searchName),
                    limit(1)
                );
                // getDocs is now available because it was added to the import list
                const querySnapshot = await getDocs(q);

                if (querySnapshot.empty) {
                    return `Error: Usuario '${friendDisplayName}' no encontrado.`;
                }

                const friendDoc = querySnapshot.docs[0];
                const friendData = friendDoc.data();
                const friendId = friendData.userId;
                const friendName = friendData.displayName;

                // 2. Check if already friends
                if (state.friends.some(f => f.id === friendId)) {
                    return `Ya eres amigo de ${friendName}.`;
                }

                const newFriend = {
                    id: friendId,
                    name: friendName,
                    chatId: generateChatId(state.userId, friendId)
                };

                // 3. Use transaction to update both user's friend lists atomically
                await runTransaction(db, async (transaction) => {
                    // Update current user's list
                    const myFriendRef = getFriendsCollectionRef(state.userId);
                    const myFriendDoc = await transaction.get(myFriendRef);

                    if (!myFriendDoc.exists()) {
                        transaction.set(myFriendRef, { friends: [newFriend] });
                    } else {
                        const currentFriends = myFriendDoc.data().friends || [];
                        if (!currentFriends.some(f => f.id === friendId)) {
                            transaction.update(myFriendRef, { friends: arrayUnion(newFriend) });
                        }
                    }

                    // Update friend's list
                    const friendOfFriendRef = getFriendsCollectionRef(friendId);
                    const friendOfFriendDoc = await transaction.get(friendOfFriendRef);

                    const meAsFriend = {
                        id: state.userId,
                        name: state.displayName,
                        chatId: generateChatId(state.userId, friendId)
                    };

                    if (!friendOfFriendDoc.exists()) {
                        transaction.set(friendOfFriendRef, { friends: [meAsFriend] });
                    } else {
                        const currentFriends = friendOfFriendDoc.data().friends || [];
                        if (!currentFriends.some(f => f.id === state.userId)) {
                            transaction.update(friendOfFriendRef, { friends: arrayUnion(meAsFriend) });
                        }
                    }
                });

                // Select the new friend automatically
                selectFriend(newFriend);
                return `Éxito: ¡Has agregado a ${friendName}!`;

            } catch (e) {
                console.error("Error adding friend:", e);
                return `Error desconocido al agregar amigo: ${e.message}`;
            }
        };

        // --- CHAT MANAGEMENT ---

        const getChatMessagesRef = (chatId) => {
            return collection(db, 'artifacts', appId, 'public', 'data', 'chats', chatId, 'messages');
        };

        const selectFriend = (friend) => {
            if (state.selectedFriend && state.selectedFriend.id === friend.id) return;

            // Clear previous message listeners
            unsubscribeListeners.filter(unsub => unsub.type === 'chat').forEach(unsub => unsub());
            unsubscribeListeners = unsubscribeListeners.filter(unsub => unsub.type !== 'chat');

            state.selectedFriend = friend;
            state.messages = [];
            state.isChatLoading = true;
            render(); // Rerender to show the loading state

            const q = query(
                getChatMessagesRef(friend.chatId),
                orderBy('timestamp', 'asc'),
                limit(50) // Limit to last 50 messages
            );

            const unsub = onSnapshot(q, (snapshot) => {
                state.messages = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    timestamp: doc.data().timestamp?.toDate()
                }));
                state.isChatLoading = false;
                render();
                scrollToBottom();
            }, (error) => {
                console.error("Error fetching chat messages:", error);
                state.isChatLoading = false;
                render();
            });
            unsub.type = 'chat';
            unsubscribeListeners.push(unsub);
        };

        const sendMessage = async (messageText) => {
            if (!state.selectedFriend || !messageText.trim()) return;

            const message = {
                senderId: state.userId,
                senderName: state.displayName,
                text: messageText.trim(),
                timestamp: new Date(),
            };

            try {
                await setDoc(doc(getChatMessagesRef(state.selectedFriend.chatId)), message);
            } catch (error) {
                console.error("Error sending message:", error);
            }
        };

        const scrollToBottom = () => {
            const chatBox = document.querySelector('.chat-container');
            if (chatBox) {
                // Ensure scroll happens after the next repaint cycle
                setTimeout(() => {
                    chatBox.scrollTop = chatBox.scrollHeight;
                }, 50);
            }
        };

        // --- RENDER FUNCTIONS (UI) ---

        const createCard = (title, contentHtml) => `
            <div class="p-8 w-full">
                <h1 class="text-3xl font-extrabold text-gray-800 mb-6 text-center">${title}</h1>
                ${contentHtml}
            </div>
        `;

        const renderVerification = (el) => {
            const content = `
                <form id="verificationForm" class="space-y-6 max-w-sm mx-auto p-6 bg-gray-50 rounded-lg shadow-md">
                    <p class="text-center text-sm text-gray-600">Introduce el código de verificación para acceder a la aplicación.</p>
                    <div>
                        <label for="code" class="block text-sm font-medium text-gray-700 mb-1">Código de Verificación</label>
                        <input type="password" id="code" name="code" required
                               class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition duration-150"
                               placeholder="******">
                    </div>
                    <button type="submit"
                            class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition duration-200">
                        Verificar Acceso
                    </button>
                    <p id="verificationError" class="text-red-500 text-sm text-center"></p>
                </form>
            `;
            el.innerHTML = createCard('Acceso Restringido', content);

            document.getElementById('verificationForm').onsubmit = (e) => {
                e.preventDefault();
                const inputCode = document.getElementById('code').value.trim();
                const errorElement = document.getElementById('verificationError');

                if (inputCode === state.verificationCode) {
                    state.currentPage = 'login'; // Go to login after successful verification
                    render();
                } else {
                    errorElement.textContent = 'Código incorrecto. Inténtalo de nuevo.';
                }
            };
        };

        const renderAuthForm = (el, type) => {
            const isRegister = type === 'register';
            const title = isRegister ? 'Registro de Nuevo Usuario' : 'Iniciar Sesión';

            const passwordConfirmField = isRegister ? `
                <div>
                    <label for="confirmPassword" class="block text-sm font-medium text-gray-700 mb-1">Confirmar Contraseña</label>
                    <input type="password" id="confirmPassword" required minlength="6"
                           class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition duration-150">
                </div>
            ` : '';

            const switchLink = isRegister ? `
                <p class="text-center text-sm mt-4">
                    ¿Ya tienes cuenta?
                    <a href="#" id="switchToLogin" class="text-indigo-600 hover:text-indigo-800 font-semibold transition duration-150">Inicia Sesión</a>
                </p>
            ` : `
                <p class="text-center text-sm mt-4">
                    ¿No tienes cuenta?
                    <a href="#" id="switchToRegister" class="text-indigo-600 hover:text-indigo-800 font-semibold transition duration-150">Regístrate Aquí</a>
                </p>
            `;

            const content = `
                <form id="${type}Form" class="space-y-6 max-w-sm mx-auto p-6 bg-gray-50 rounded-lg shadow-md">
                    <div>
                        <label for="displayName" class="block text-sm font-medium text-gray-700 mb-1">Nombre de Usuario</label>
                        <input type="text" id="displayName" required
                               class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition duration-150"
                               placeholder="Introduce tu nombre único">
                    </div>
                    <div>
                        <label for="password" class="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
                        <input type="password" id="password" required minlength="6"
                               class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition duration-150">
                    </div>
                    ${passwordConfirmField}
                    <button type="submit"
                            class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition duration-200">
                        ${isRegister ? 'Registrar y Entrar' : 'Acceder a Chat'}
                    </button>
                    <p id="authError" class="text-red-500 text-sm text-center"></p>
                </form>
                ${switchLink}
            `;
            el.innerHTML = createCard(title, content);

            // Setup listeners
            document.getElementById(`${type}Form`).onsubmit = (e) => isRegister ? handleRegister(e) : handleLogin(e);

            if (document.getElementById('switchToLogin')) {
                document.getElementById('switchToLogin').onclick = (e) => {
                    e.preventDefault();
                    state.currentPage = 'login';
                    render();
                };
            }
            if (document.getElementById('switchToRegister')) {
                document.getElementById('switchToRegister').onclick = (e) => {
                    e.preventDefault();
                    state.currentPage = 'register';
                    render();
                };
            }
        };

        const handleError = (msg) => {
            const errorElement = document.getElementById('authError');
            if (errorElement) errorElement.textContent = msg;
        };

        const handleRegister = async (e) => {
            e.preventDefault();
            handleError(''); // Clear errors
            const displayName = document.getElementById('displayName').value.trim();
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            if (password.length < 6) return handleError("La contraseña debe tener al menos 6 caracteres.");
            if (password !== confirmPassword) return handleError("Las contraseñas no coinciden.");

            try {
                // 1. Check if displayName is already taken
                const q = query(
                    collection(db, 'artifacts', appId, 'public', 'data', 'user_profiles'),
                    where('searchName', '==', displayName.toLowerCase()),
                    limit(1)
                );
                const querySnapshot = await getDocs(q); // getDocs is now defined
                if (!querySnapshot.empty) {
                    return handleError("Nombre de usuario ya en uso. Elige otro.");
                }

                // 2. Save profile (implicitly logging the user in through the initial auth)
                await saveUserProfile(displayName, password);

                // 3. Success
                state.currentPage = 'dashboard';
                fetchFriends();
                render();

            } catch (error) {
                handleError(`Error al registrar: ${error.message}`);
                console.error("Registration Error:", error);
            }
        };

        const handleLogin = async (e) => {
            e.preventDefault();
            handleError(''); // Clear errors
            const displayName = document.getElementById('displayName').value.trim();
            const password = document.getElementById('password').value;

            try {
                // 1. Find the user profile by display name
                const q = query(
                    collection(db, 'artifacts', appId, 'public', 'data', 'user_profiles'),
                    where('searchName', '==', displayName.toLowerCase()),
                    limit(1)
                );
                const querySnapshot = await getDocs(q); // getDocs is now defined

                if (querySnapshot.empty) {
                    return handleError("Nombre de usuario no encontrado.");
                }

                const userDoc = querySnapshot.docs[0];
                const userData = userDoc.data();

                // 2. Check the simulated password (requires client-side storage or more complex setup)
                // For this single-file environment, we rely on the password stored in Firestore metadata
                if (userData.passwordHash !== password) {
                    return handleError("Contraseña incorrecta.");
                }

                // 3. User Found & Password Correct -> Simulate login success (if auth is already done)
                state.displayName = userData.displayName;
                state.userId = userData.userId; // Ensure the state userId matches the retrieved one
                
                // If the user's current Firebase UID doesn't match the one in the profile,
                // we would need to sign out and sign in the correct user.
                // Since we rely on a single, persistent __initial_auth_token session, we just update the state.

                state.currentPage = 'dashboard';
                fetchFriends();
                render();

            } catch (error) {
                handleError(`Error al iniciar sesión: ${error.message}`);
                console.error("Login Error:", error);
            }
        };

        const renderDashboard = (el) => {
            if (!state.isAuthReady) {
                 el.innerHTML = `<div class="p-8 text-center w-full">Cargando autenticación...</div>`;
                 return;
            }

            // Chat Interface Layout (Sidebar and Main Chat)
            el.innerHTML = `
                <!-- PWA Installation Tip -->
                <div class="p-2 bg-indigo-100 text-indigo-800 text-sm text-center font-medium w-full">
                    <p>¡Consejo! Esta web funciona como una app. Abre el menú de tu navegador y busca la opción **"Instalar aplicación"**.</p>
                </div>
                <!-- Chat Content -->
                <div class="flex-grow flex flex-col md:flex-row w-full">
                    <!-- Sidebar (Friend List) -->
                    <div class="w-full md:w-1/3 bg-gray-50 border-r border-gray-200 flex flex-col">
                        <div class="p-4 border-b border-gray-200">
                            <h2 class="text-xl font-bold text-indigo-700">Chats</h2>
                            <p class="text-xs text-gray-500 mt-1">Usuario: ${state.displayName} (${state.userId.substring(0, 8)}...)</p>
                        </div>

                        <!-- Add Friend Form -->
                        <div class="p-4 border-b border-gray-200">
                            <h3 class="font-semibold mb-2 text-sm text-gray-700">Agregar Amigo</h3>
                            <form id="addFriendForm" class="flex space-x-2">
                                <input type="text" id="friendNameInput" placeholder="Nombre de usuario" required
                                    class="flex-grow px-3 py-1 border border-gray-300 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500">
                                <button type="submit"
                                    class="bg-indigo-500 hover:bg-indigo-600 text-white p-2 rounded-lg text-xs font-medium transition duration-150">
                                    Agregar
                                </button>
                            </form>
                            <p id="friendStatus" class="mt-2 text-xs"></p>
                        </div>

                        <!-- Friend List -->
                        <div id="friendList" class="flex-grow overflow-y-auto">
                            <!-- Friends will be injected here -->
                        </div>
                    </div>

                    <!-- Main Chat Window -->
                    <div class="w-full md:w-2/3 flex flex-col">
                        ${state.selectedFriend ? renderChatWindow() : renderWelcomeScreen()}
                    </div>
                </div>
            `;

            // Inject friend list items
            const friendListEl = document.getElementById('friendList');
            friendListEl.innerHTML = state.friends.length === 0
                ? `<p class="p-4 text-sm text-gray-500 text-center">No hay amigos. ¡Agrega uno!</p>`
                : state.friends.map(friend => `
                    <div id="friend-${friend.id}" data-id="${friend.id}"
                        class="p-3 border-b border-gray-100 cursor-pointer flex justify-between items-center transition duration-150
                        ${state.selectedFriend && state.selectedFriend.id === friend.id ? 'bg-indigo-100 border-l-4 border-indigo-600 font-semibold' : 'hover:bg-gray-100'}">
                        <span class="text-gray-800">${friend.name}</span>
                        <!-- You could add notification badges here -->
                    </div>
                `).join('');

            // Add click listeners to friend list items
            state.friends.forEach(friend => {
                document.getElementById(`friend-${friend.id}`).onclick = () => selectFriend(friend);
            });

            // Add Friend Form Listener
            document.getElementById('addFriendForm').onsubmit = async (e) => {
                e.preventDefault();
                const friendNameInput = document.getElementById('friendNameInput');
                const statusEl = document.getElementById('friendStatus');
                const friendName = friendNameInput.value.trim();

                statusEl.className = 'mt-2 text-xs text-gray-600';
                statusEl.textContent = 'Buscando y agregando...';

                const result = await addFriendByDisplayName(friendName);

                if (result.startsWith('Error')) {
                    statusEl.className = 'mt-2 text-xs text-red-500';
                } else if (result.startsWith('Ya eres')) {
                    statusEl.className = 'mt-2 text-xs text-yellow-600';
                } else {
                    statusEl.className = 'mt-2 text-xs text-green-600';
                    friendNameInput.value = ''; // Clear input on success
                }
                statusEl.textContent = result;
            };

             // Logout button listener
            document.getElementById('logoutButton').onclick = async () => {
                try {
                    await signOut(auth);
                    state.displayName = null;
                    state.selectedFriend = null;
                    state.messages = [];
                    state.friends = [];
                    state.currentPage = 'login'; // Go back to login screen
                    // Clear all chat listeners
                    unsubscribeListeners.forEach(unsub => unsub());
                    unsubscribeListeners = [];
                    render();
                } catch (error) {
                    console.error("Error signing out:", error);
                }
            };
        };

        const renderWelcomeScreen = () => `
            <div class="flex-grow flex items-center justify-center p-8 bg-gray-50">
                <div class="text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-16 h-16 mx-auto text-indigo-400 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    <h3 class="text-2xl font-semibold text-gray-700 mb-2">¡Bienvenido al Chat!</h3>
                    <p class="text-gray-500">Selecciona un amigo de la lista o utiliza el campo 'Agregar Amigo' para empezar a chatear.</p>
                    <button id="logoutButton" class="mt-6 bg-red-500 hover:bg-red-600 text-white font-medium py-2 px-4 rounded-lg text-sm transition duration-150">Cerrar Sesión</button>
                </div>
            </div>
        `;

        const renderChatWindow = () => {
            const friend = state.selectedFriend;
            if (!friend) return '';

            // This function is complex, let's keep it clean
            setTimeout(scrollToBottom, 100);

            return `
                <!-- Chat Header -->
                <div class="p-4 bg-indigo-600 text-white shadow-md flex justify-between items-center">
                    <h3 class="text-lg font-semibold">${friend.name}</h3>
                    <button id="logoutButton" class="text-white hover:text-indigo-200 transition duration-150 text-sm">
                        Cerrar Sesión
                    </button>
                </div>

                <!-- Chat Messages (Container) -->
                <div class="chat-container flex-grow p-4 space-y-4 bg-gray-50">
                    ${state.isChatLoading ? `<p class="text-center text-gray-500">Cargando mensajes...</p>` : renderMessages()}
                </div>

                <!-- Chat Input -->
                <div class="p-4 border-t border-gray-200 bg-white">
                    <form id="messageForm" class="flex space-x-2">
                        <input type="text" id="messageInput" placeholder="Escribe un mensaje..." required
                            class="flex-grow px-4 py-2 border border-gray-300 rounded-full focus:ring-indigo-500 focus:border-indigo-500 transition duration-150">
                        <button type="submit"
                            class="bg-indigo-600 hover:bg-indigo-700 text-white p-2 rounded-full w-10 h-10 flex items-center justify-center shadow-lg transition duration-150">
                            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 19l11-12L2 6l5 5 2 7zM11 19l-2-7-5-5"/></svg>
                        </button>
                    </form>
                </div>
            `;
        };

        const renderMessages = () => {
            if (state.messages.length === 0) {
                return `<p class="text-center text-gray-500 mt-10">¡Empieza a chatear! Sé el primero en enviar un mensaje.</p>`;
            }

            return state.messages.map(msg => {
                const isMe = msg.senderId === state.userId;
                const alignment = isMe ? 'justify-end' : 'justify-start';
                const bgColor = isMe ? 'bg-indigo-500 text-white' : 'bg-white text-gray-800 border border-gray-200';
                const senderName = isMe ? 'Tú' : msg.senderName;
                const timeString = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

                return `
                    <div class="flex ${alignment}">
                        <div class="max-w-xs md:max-w-md">
                            <p class="text-xs ${isMe ? 'text-right' : 'text-left'} text-gray-600 mb-1">${senderName}</p>
                            <div class="px-4 py-2 rounded-xl shadow-md ${bgColor} break-words">
                                ${msg.text}
                            </div>
                            <p class="text-xs ${isMe ? 'text-right' : 'text-left'} text-gray-400 mt-1">${timeString}</p>
                        </div>
                    </div>
                `;
            }).join('');
        };


        // --- MAIN APPLICATION STARTUP ---
        initializeAppAndAuth().catch(e => console.error("Initialization Failed:", e));

        // Add event listener for message sending outside of the render function for performance
        document.addEventListener('submit', (e) => {
            if (e.target.id === 'messageForm') {
                e.preventDefault();
                const inputElement = document.getElementById('messageInput');
                const messageText = inputElement.value;
                if (messageText) {
                    sendMessage(messageText);
                    inputElement.value = ''; // Clear input
                }
            }
        });

    </script>
</body>
</html>