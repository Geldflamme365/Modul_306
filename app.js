import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, deleteDoc, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

// AI API Keys (Stored locally for fully static frontend)
// WARNING: In a real production app, client-side API keys are insecure.
// Since this project forbids a backend and requires a static 3-file setup,
// the APIs are called directly from the browser.
const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY";
const GROQ_API_KEY = "YOUR_GROQ_API_KEY";
const GROQ_API_KEY_2 = "YOUR_SECOND_GROQ_API_KEY";

// Using Gemma 2 27B, the highest current Gemma model available on Google AI Studio, as Gemma 4 26B is not a valid endpoint ID
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemma-2-27b-it:generateContent";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const firebaseConfig = {
  apiKey: "AIzaSyAWilRm21xKlWDAUzYWMETG3Ate2vrKatE",
  authDomain: "mini-games-ead4b.firebaseapp.com",
  projectId: "mini-games-ead4b",
  storageBucket: "mini-games-ead4b.firebasestorage.app",
  messagingSenderId: "967356040514",
  appId: "1:967356040514:web:a5825799e9e4bf773134db"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
let currentUser = null;

// Edit mode state
let editingDocId = null;

// DOM Elements
const form = document.getElementById("publish-form");
const submitBtn = document.getElementById("publish-btn");
const previewBtn = document.getElementById("preview-btn");
const cancelEditBtn = document.getElementById("cancel-edit-btn");
const editModeBanner = document.getElementById("edit-mode-banner");
const editModeTitle = document.getElementById("edit-mode-title");
const publishPanelTitle = document.getElementById("publish-panel-title");
const resultBox = document.getElementById("review-result");
const appList = document.getElementById("apps-list");
const fileUpload = document.getElementById("file-upload");
const htmlTextarea = document.getElementById("html");

const viewerPlaceholder = document.getElementById("viewer-placeholder");
const viewerContent = document.getElementById("viewer-content");
const appIframe = document.getElementById("app-iframe");
const closeViewerBtn = document.getElementById("close-viewer-btn");
const viewerTitle = document.getElementById("viewer-title");

// Auth Elements
const authForm = document.getElementById("auth-form");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const loginBtn = document.getElementById("login-btn");
const registerBtn = document.getElementById("register-btn");
const logoutBtn = document.getElementById("logout-btn");
const authLoggedOut = document.getElementById("auth-logged-out");
const authLoggedIn = document.getElementById("auth-logged-in");
const authUserEmail = document.getElementById("auth-user-email");
const authStatusBadge = document.getElementById("auth-status-badge");
const authResult = document.getElementById("auth-result");

// Auth Snapshot Refresher
let latestAppsSnapshot = null;

// Auth State Listener
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  const myProjPanel = document.getElementById("my-projects-panel");

  if (user) {
    authLoggedOut.classList.add("hidden");
    authLoggedIn.classList.remove("hidden");
    authUserEmail.textContent = user.email;
    authStatusBadge.textContent = "Logged In";
    authStatusBadge.style.background = "rgba(46, 204, 113, 0.2)";
    authStatusBadge.style.color = "#2ecc71";
    
    // Enable Publish Form
    submitBtn.disabled = false;
    document.getElementById("title").disabled = false;
    document.getElementById("description").disabled = false;
    document.getElementById("html").disabled = false;
    resultBox.textContent = "";

    if (myProjPanel) myProjPanel.classList.remove("hidden");
  } else {
    authLoggedOut.classList.remove("hidden");
    authLoggedIn.classList.add("hidden");
    authStatusBadge.textContent = "Logged Out";
    authStatusBadge.style.background = "";
    authStatusBadge.style.color = "";

    // Disable Publish Form
    submitBtn.disabled = true;
    document.getElementById("title").disabled = true;
    document.getElementById("description").disabled = true;
    document.getElementById("html").disabled = true;
    showResult(false, "You must log in to publish an app.");

    if (myProjPanel) myProjPanel.classList.add("hidden");

    // Exit edit mode on logout
    exitEditMode();
  }
  
  if (typeof renderApps === "function") renderApps();
});

// Auth Handlers
authForm.addEventListener("submit", async (e) => {
  e.preventDefault(); // Default submit is login
  try {
    await signInWithEmailAndPassword(auth, authEmail.value, authPassword.value);
    authResult.textContent = "";
    authForm.reset();
  } catch (err) {
    authResult.textContent = err.message;
    authResult.className = "result false";
  }
});

registerBtn.addEventListener("click", async () => {
  if (!authEmail.value || !authPassword.value) {
    authResult.textContent = "Please enter email and password to register.";
    authResult.className = "result false";
    return;
  }
  try {
    await createUserWithEmailAndPassword(auth, authEmail.value, authPassword.value);
    authResult.textContent = "";
    authForm.reset();
  } catch (err) {
    authResult.textContent = err.message;
    authResult.className = "result false";
  }
});

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

// Load File Content visually (Handling Directories / Multiple Files)
const dropZone = document.getElementById("drop-zone");

async function processFiles(files) {
  if (!files || files.length === 0) return;
  
  let htmlContent = "";
  let cssContent = "";
  let jsContent = "";
  let mainHtmlFile = null;

  // Read all files dumped into standard array
  const fileArray = Array.from(files);

  // Naive processing: look for index.html, .css, .js
  for (const file of fileArray) {
    if (file.name.endsWith('.html') || file.name.endsWith('.htm')) {
      if (file.name === 'index.html' || !mainHtmlFile) {
        mainHtmlFile = file;
      }
    } else if (file.name.endsWith('.css')) {
      cssContent += `\n/* From ${file.name} */\n` + await file.text();
    } else if (file.name.endsWith('.js')) {
      jsContent += `\n/* From ${file.name} */\n` + await file.text();
    }
  }

  if (mainHtmlFile) {
    htmlContent = await mainHtmlFile.text();
    
    // Basic automatic injection of dropped CSS/JS
    if (cssContent) {
      const styleBlock = `<style>${cssContent}</style>`;
      if (htmlContent.includes('</head>')) {
        htmlContent = htmlContent.replace('</head>', `${styleBlock}\n</head>`);
      } else {
        htmlContent = styleBlock + '\n' + htmlContent;
      }
    }
    
    if (jsContent) {
      const scriptBlock = `<script>${jsContent}<\/script>`;
      if (htmlContent.includes('</body>')) {
        htmlContent = htmlContent.replace('</body>', `${scriptBlock}\n</body>`);
      } else {
        htmlContent += '\n' + scriptBlock;
      }
    }
    
    htmlTextarea.value = htmlContent;
    dropZone.querySelector('p').textContent = `Loaded ${fileArray.length} files!`;
    dropZone.querySelector('p').style.color = '#10b981';
    dropZone.querySelector('.drop-icon').textContent = '✅';
  } else {
    alert("No HTML file found in the dropped folder!");
    dropZone.querySelector('p').textContent = `No HTML found!`;
    dropZone.querySelector('p').style.color = '#ef4444';
    dropZone.querySelector('.drop-icon').textContent = '⚠️';
  }
}

fileUpload.addEventListener("change", async (e) => {
  await processFiles(e.target.files);
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  
  if (e.dataTransfer.items) {
    // Collect files using webkitGetAsEntry to support folders properly if available
    const files = [];
    const promises = [];
    
    for (let i = 0; i < e.dataTransfer.items.length; i++) {
      const item = e.dataTransfer.items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry && entry.isDirectory) {
          promises.push(readDirectory(entry, files));
        } else {
          files.push(item.getAsFile());
        }
      }
    }
    
    await Promise.all(promises);
    await processFiles(files);
  } else {
    await processFiles(e.dataTransfer.files);
  }
});

function readDirectory(directoryEntry, fileList) {
  return new Promise((resolve, reject) => {
    const dirReader = directoryEntry.createReader();
    dirReader.readEntries(async (entries) => {
      const promises = [];
      for (const entry of entries) {
        if (entry.isFile) {
          promises.push(new Promise((res) => entry.file(f => { fileList.push(f); res(); })));
        } else if (entry.isDirectory) {
          promises.push(readDirectory(entry, fileList));
        }
      }
      await Promise.all(promises);
      resolve();
    }, reject);
  });
}

// App Viewer
function openAppViewer(id, title, html) {
  const viewerPlaceholder = document.getElementById("viewer-placeholder");
  if (viewerPlaceholder) viewerPlaceholder.classList.add("hidden");
  viewerContent.classList.remove("hidden");
  viewerTitle.textContent = title;
  appIframe.srcdoc = html;
  
  // Set URL so apps have their own link
  const url = new URL(window.location);
  url.searchParams.set('app', id);
  window.history.pushState({}, '', url);
}

closeViewerBtn.addEventListener("click", () => {
  viewerContent.classList.add("hidden");
  const viewerPlaceholder = document.getElementById("viewer-placeholder");
  if (viewerPlaceholder) viewerPlaceholder.classList.remove("hidden");
  appIframe.srcdoc = "";

  // Clear URL app link
  const url = new URL(window.location);
  url.searchParams.delete('app');
  window.history.pushState({}, '', url);
});

// Check URL on load or back/forward navigation
async function handleUrlState() {
  const params = new URLSearchParams(window.location.search);
  const appId = params.get('app');
  
  if (appId) {
    try {
      const docRef = doc(db, "apps", appId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        openAppViewer(appId, data.title, data.html);
      }
    } catch (e) {
      console.warn("Could not load direct app link", e);
    }
  } else {
    viewerContent.classList.add("hidden");
    appIframe.srcdoc = "";
  }
}

window.addEventListener('popstate', handleUrlState);
handleUrlState(); // Check on initial load

function showResult(isSuccess, message) {
  resultBox.textContent = message;
  resultBox.className = `result ${isSuccess ? "true" : "false"}`;
}

// --- PREVIEW LOGIC ---
previewBtn.addEventListener("click", () => {
  const html = document.getElementById("html").value;
  const title = document.getElementById("title").value.trim() || "Preview";

  if (!html.trim()) {
    showResult(false, "Nothing to preview — add some HTML code first.");
    return;
  }

  // Close the sidebar overlay before showing the preview
  const optionsOverlay = document.getElementById("options-overlay");
  if (optionsOverlay) optionsOverlay.classList.add("hidden");

  // Open the viewer with a special preview ID (not a real Firestore doc)
  openAppViewer("__preview__", `👁️ Preview: ${title}`, html);
});

// --- EDIT MODE LOGIC ---
function enterEditMode(docId, data) {
  editingDocId = docId;

  // Populate form with existing data
  document.getElementById("title").value = data.title || "";
  document.getElementById("description").value = data.description || "";
  document.getElementById("html").value = data.html || "";

  // Update UI to show edit mode
  publishPanelTitle.textContent = "Edit App";
  submitBtn.textContent = "💾 Save Changes";
  cancelEditBtn.classList.remove("hidden");
  editModeBanner.classList.remove("hidden");
  editModeTitle.textContent = data.title || "Untitled";

  // Scroll the publish panel into view
  const publishPanel = document.getElementById("publish-panel");
  if (publishPanel) publishPanel.scrollIntoView({ behavior: "smooth", block: "start" });

  showResult(null, "");
}

function exitEditMode() {
  editingDocId = null;

  // Reset UI
  publishPanelTitle.textContent = "Create App";
  submitBtn.textContent = "🚀 Review & Publish";
  cancelEditBtn.classList.add("hidden");
  editModeBanner.classList.add("hidden");
  editModeTitle.textContent = "";

  // Clear form
  form.reset();
  resetDropZone();
  showResult(null, "");
}

function resetDropZone() {
  const dropZoneIcon = document.querySelector('.drop-icon');
  const dropZoneText = document.querySelector('.drop-content p');
  if (dropZoneIcon && dropZoneText) {
    dropZoneIcon.textContent = '📂';
    dropZoneText.textContent = 'Drag & Drop your game folder here';
    dropZoneText.style.color = '';
  }
}

cancelEditBtn.addEventListener("click", () => {
  exitEditMode();
});

// Live Apps Listener
const appsQuery = query(collection(db, "apps"), orderBy("createdAt", "desc"));
onSnapshot(appsQuery, (snapshot) => {
  latestAppsSnapshot = snapshot;
  renderApps();
});

function renderApps() {
  appList.innerHTML = "";
  const myProjectsList = document.getElementById("my-projects-list");
  if (myProjectsList) myProjectsList.innerHTML = "";

  if (!latestAppsSnapshot || latestAppsSnapshot.empty) {
    appList.innerHTML = '<p style="opacity: 0.5;">No apps published yet.</p>';
    if (myProjectsList) myProjectsList.innerHTML = '<p style="opacity: 0.5;">No projects yet.</p>';
    return;
  }

  const template = document.getElementById("app-card-template");
  const myProjectTemplate = document.getElementById("my-project-card-template");

  latestAppsSnapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const docId = docSnap.id;
    
    // Main App Card
    const node = template.content.cloneNode(true);
    const cardElement = node.querySelector(".app-card");
    const previewFrame = node.querySelector(".app-preview");
    
    node.querySelector(".app-title").textContent = data.title;
    node.querySelector(".app-description").textContent = data.description || "No description provided.";
    if (previewFrame) {
      previewFrame.srcdoc = data.html || "";
    }
    
    cardElement.addEventListener("click", () => {
      openAppViewer(docId, data.title, data.html);
    });
    cardElement.style.cursor = "pointer";

    appList.appendChild(node);

    // My Projects Card (in Sidebar)
    if (currentUser && data.userId === currentUser.uid && myProjectsList && myProjectTemplate) {
      const myNode = myProjectTemplate.content.cloneNode(true);
      myNode.querySelector(".app-title").textContent = data.title;
      
      myNode.querySelector(".app-play").addEventListener("click", () => {
        openAppViewer(docId, data.title, data.html);
      });

      // Edit button handler
      myNode.querySelector(".app-edit").addEventListener("click", () => {
        enterEditMode(docId, data);
      });

      myNode.querySelector(".app-delete").addEventListener("click", async () => {
        if (confirm("Are you sure you want to delete this app?")) {
          try {
            await deleteDoc(doc(db, "apps", docId));
            // If we were editing this app, exit edit mode
            if (editingDocId === docId) {
              exitEditMode();
            }
          } catch (err) {
            alert("Error deleting app: " + err.message);
          }
        }
      });
      myProjectsList.appendChild(myNode);
    }
  });

  if (myProjectsList && myProjectsList.children.length === 0) {
    myProjectsList.innerHTML = '<p style="opacity: 0.5;">No projects yet.</p>';
  }
}

// --- AI REVIEW LOGIC ---
const promptText = `
You are a strict security gate for user-submitted HTML mini web apps.
Analyze the code and decide if it is safe enough to publish on a public mini-app platform.
Return only one word: true or false.
Return true only when no significant security risk exists.
Return false if there are risks like script injection abuse, dangerous data exfiltration patterns, malware behavior, or remote script execution.
Do not explain. Output must be exactly true or false.
User HTML:
`;

async function runGeminiReview(html) {
  const response = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: promptText + html }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 4 }
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API failed: ${response.status} - ${errorText}`);
  }
  const json = await response.json();
  const resultText = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return resultText.trim().toLowerCase().includes("true");
}

async function runGroqReview(html, apiKey) {
  const response = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: promptText + html }],
      temperature: 0,
      max_tokens: 4
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API failed: ${response.status} - ${errorText}`);
  }
  const json = await response.json();
  const resultText = json.choices?.[0]?.message?.content || "";
  return resultText.trim().toLowerCase().includes("true");
}

// Form Submission (handles both Create and Update)
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const title = document.getElementById("title").value.trim();
  const description = document.getElementById("description").value.trim();
  const html = document.getElementById("html").value;

  submitBtn.disabled = true;

  try {
    if (editingDocId) {
      // UPDATE existing document
      showResult(null, "Saving changes...");
      await updateDoc(doc(db, "apps", editingDocId), {
        title,
        description,
        html
      });
      showResult(true, "Changes saved successfully!");
      exitEditMode();
    } else {
      // CREATE new document
      showResult(null, "Publishing to Firestore...");

      // Code review temporarily disabled completely.
      // Send to Firestore directly from frontend immediately.

      await addDoc(collection(db, "apps"), {
        title,
        description,
        html,
        userId: currentUser.uid,
        createdAt: serverTimestamp()
      });

      showResult(true, "Published successfully!");
      form.reset();
      resetDropZone();
    }
  } catch (error) {
    showResult(false, `Error: ${error.message}`);
  } finally {
    submitBtn.disabled = false;
  }
});
