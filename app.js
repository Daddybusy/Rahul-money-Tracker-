import { app } from "./firebase-config.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const auth = getAuth(app);

let db;

try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (error) {
  console.warn("Persistent Firestore cache initialization failed.", error);
  db = initializeFirestore(app);
}

/* =========================================================
   GLOBAL STATE
========================================================= */

const state = {
  user: null,
  accounts: [],
  categories: [],
  transactions: [],
  preferences: {
    monthlyBudget: 0,
    theme: "light"
  },
  currentPage: "home",
  analyticsPeriod: "week",
  online: navigator.onLine,
  locked: false,
  pinEnabled: localStorage.getItem("rma_pin_enabled") === "true"
};

let unsubscribeAccounts = null;
let unsubscribeCategories = null;
let unsubscribeTransactions = null;
let unsubscribePreferences = null;

const DEFAULT_ACCOUNTS = [
  "eSewa",
  "MBL",
  "NMB Mobile Banking",
  "Cash"
];

const DEFAULT_CATEGORIES = [
  "Food",
  "Transport",
  "Shopping",
  "Bills",
  "Education",
  "Health",
  "Entertainment",
  "Recharge",
  "Rent",
  "Travel",
  "Family",
  "Personal",
  "Other"
];

/* =========================================================
   DOM HELPERS
========================================================= */

const $ = (id) => document.getElementById(id);

function qs(selector) {
  return document.querySelector(selector);
}

function qsa(selector) {
  return [...document.querySelectorAll(selector)];
}

/* =========================================================
   UTILITIES
========================================================= */

function money(value) {
  const number = Number(value) || 0;

  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(number);
}

function rupees(value) {
  return `Rs. ${money(value)}`;
}

function todayString() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(value) {
  return String(value ?? "").toLowerCase().trim();
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "error" : ""}`;
  toast.textContent = message;

  $("toastContainer").appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3200);
}

function setGlobalLoading(show, message = "Loading...") {
  $("globalLoadingText").textContent = message;
  $("globalLoading").classList.toggle("hidden", !show);
}

function setButtonLoading(button, loading) {
  if (!button) return;

  button.disabled = loading;

  const spinner = button.querySelector(".spinner");

  if (spinner) {
    spinner.classList.toggle("hidden", !loading);
  }
}

function showAuthError(message) {
  const box = $("authError");
  box.textContent = message;
  box.classList.remove("hidden");
}

function clearAuthError() {
  $("authError").classList.add("hidden");
  $("authError").textContent = "";
}

function firebaseError(error) {
  const code = error?.code || "";

  const messages = {
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/user-not-found": "No account was found with this email.",
    "auth/wrong-password": "Incorrect email or password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/email-already-in-use": "This email is already registered.",
    "auth/weak-password": "Password must contain at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
    "auth/network-request-failed": "Network error. Check your internet connection.",
    "auth/operation-not-allowed": "Email/password authentication is not enabled.",
    "permission-denied": "You do not have permission to perform this action.",
    "failed-precondition": "Firestore is not ready. Please try again.",
    "unavailable": "Firebase is temporarily unavailable.",
    "resource-exhausted": "Firebase quota has been reached.",
    "deadline-exceeded": "The operation took too long. Please try again."
  };

  return messages[code] || "Something went wrong. Please try again.";
}

function getUserPath(collectionName) {
  if (!state.user) throw new Error("No authenticated user.");
  return collection(db, "users", state.user.uid, collectionName);
}

function getUserDoc() {
  if (!state.user) throw new Error("No authenticated user.");
  return doc(db, "users", state.user.uid);
}

/* =========================================================
   THEME
========================================================= */

function applyTheme(theme) {
  const safeTheme = theme === "dark" ? "dark" : "light";

  document.documentElement.dataset.theme = safeTheme;

  state.preferences.theme = safeTheme;

  $("themeToggleBtn").textContent = safeTheme === "dark" ? "☀" : "☾";
  $("currentThemeLabel").textContent =
    safeTheme === "dark" ? "Dark" : "Light";
}

function loadLocalTheme() {
  const theme = localStorage.getItem("rma_theme") || "light";
  applyTheme(theme);
}

async function toggleTheme() {
  const next = state.preferences.theme === "dark" ? "light" : "dark";

  localStorage.setItem("rma_theme", next);
  applyTheme(next);

  if (state.user) {
    try {
      await savePreferences({
        theme: next
      });
    } catch (error) {
      console.warn(error);
    }
  }
}

/* =========================================================
   FIRESTORE PATHS
========================================================= */

function accountsCollection() {
  return getUserPath("accounts");
}

function categoriesCollection() {
  return getUserPath("categories");
}

function transactionsCollection() {
  return getUserPath("transactions");
}

function preferencesDoc() {
  return doc(db, "users", state.user.uid, "settings", "preferences");
}

/* =========================================================
   USER INITIALIZATION
========================================================= */

async function initializeNewUser(user, displayName) {
  const userRef = doc(db, "users", user.uid);

  const batch = writeBatch(db);

  batch.set(userRef, {
    uid: user.uid,
    displayName: displayName,
    email: user.email || "",
    createdAt: serverTimestamp()
  }, { merge: true });

  for (const accountName of DEFAULT_ACCOUNTS) {
    const accountRef = doc(accountsCollection());
    batch.set(accountRef, {
      name: accountName,
      openingBalance: 0,
      createdAt: serverTimestamp()
    });
  }

  for (const categoryName of DEFAULT_CATEGORIES) {
    const categoryRef = doc(categoriesCollection());

    batch.set(categoryRef, {
      name: categoryName,
      createdAt: serverTimestamp()
    });
  }

  batch.set(preferencesDoc(), {
    monthlyBudget: 0,
    theme: localStorage.getItem("rma_theme") || "light",
    updatedAt: serverTimestamp()
  }, { merge: true });

  await batch.commit();
}

async function ensureUserDocuments() {
  const userRef = getUserDoc();
  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    await initializeNewUser(
      state.user,
      state.user.displayName || "User"
    );
    return;
  }

  const accountsSnapshot = await getDocs(accountsCollection());

  if (accountsSnapshot.empty) {
    const batch = writeBatch(db);

    for (const accountName of DEFAULT_ACCOUNTS) {
      batch.set(doc(accountsCollection()), {
        name: accountName,
        openingBalance: 0,
        createdAt: serverTimestamp()
      });
    }

    await batch.commit();
  }

  const categoriesSnapshot = await getDocs(categoriesCollection());

  if (categoriesSnapshot.empty) {
    const batch = writeBatch(db);

    for (const categoryName of DEFAULT_CATEGORIES) {
      batch.set(doc(categoriesCollection()), {
        name: categoryName,
        createdAt: serverTimestamp()
      });
    }

    await batch.commit();
  }

  const pref = await getDoc(preferencesDoc());

  if (!pref.exists()) {
    await setDoc(preferencesDoc(), {
      monthlyBudget: 0,
      theme: localStorage.getItem("rma_theme") || "light",
      updatedAt: serverTimestamp()
    });
  }
}

/* =========================================================
   AUTH
========================================================= */

async function setupAuthPersistence() {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (error) {
    console.warn("Auth persistence failed:", error);
  }
}

async function handleLogin(event) {
  event.preventDefault();

  clearAuthError();

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  const button = $("loginBtn");

  if (!email || !password) {
    showAuthError("Email and password are required.");
    return;
  }

  setButtonLoading(button, true);

  try {
    await signInWithEmailAndPassword(auth, email, password);
    $("loginForm").reset();
  } catch (error) {
    showAuthError(firebaseError(error));
  } finally {
    setButtonLoading(button, false);
  }
}

async function handleRegister(event) {
  event.preventDefault();

  clearAuthError();

  const name = $("registerName").value.trim();
  const email = $("registerEmail").value.trim();
  const password = $("registerPassword").value;
  const button = $("registerBtn");

  if (!name) {
    showAuthError("Please enter your name.");
    return;
  }

  if (password.length < 6) {
    showAuthError("Password must contain at least 6 characters.");
    return;
  }

  setButtonLoading(button, true);

  try {
    const credential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    await updateProfile(credential.user, {
      displayName: name
    });

    await initializeNewUser(credential.user, name);

    $("registerForm").reset();

  } catch (error) {
    showAuthError(firebaseError(error));
  } finally {
    setButtonLoading(button, false);
  }
}

async function handleForgotPassword() {
  clearAuthError();

  const email = $("loginEmail").value.trim();

  if (!email) {
    showAuthError("Enter your email first.");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    showToast("Password reset email sent.");
  } catch (error) {
    showAuthError(firebaseError(error));
  }
}

async function handleLogout() {
  const confirmed = confirm("Are you sure you want to logout?");

  if (!confirmed) return;

  try {
    await signOut(auth);
  } catch (error) {
    showToast(firebaseError(error), "error");
  }
}

function showLoginForm() {
  clearAuthError();
  $("loginForm").classList.remove("hidden");
  $("registerForm").classList.add("hidden");
}

function showRegisterForm() {
  clearAuthError();
  $("loginForm").classList.add("hidden");
  $("registerForm").classList.remove("hidden");
}

/* =========================================================
   FIRESTORE LISTENERS
========================================================= */

function unsubscribeFirestoreListeners() {
  [
    unsubscribeAccounts,
    unsubscribeCategories,
    unsubscribeTransactions,
    unsubscribePreferences
  ].forEach((unsubscribe) => {
    if (typeof unsubscribe === "function") {
      unsubscribe();
    }
  });

  unsubscribeAccounts = null;
  unsubscribeCategories = null;
  unsubscribeTransactions = null;
  unsubscribePreferences = null;
}

function startFirestoreListeners() {
  unsubscribeFirestoreListeners();

  const accountsQuery = query(
    accountsCollection(),
    orderBy("name")
  );

  unsubscribeAccounts = onSnapshot(
    accountsQuery,
    (snapshot) => {
      state.accounts = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      refreshAccountSelects();
      renderDashboard();
      renderTransactions();
      renderAnalytics();
    },
    (error) => {
      showToast(firebaseError(error), "error");
    }
  );

  const categoriesQuery = query(
    categoriesCollection(),
    orderBy("name")
  );

  unsubscribeCategories = onSnapshot(
    categoriesQuery,
    (snapshot) => {
      state.categories = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      refreshCategorySelects();
      renderTransactions();
      renderDashboard();
      renderAnalytics();
    },
    (error) => {
      showToast(firebaseError(error), "error");
    }
  );

  const transactionsQuery = query(
    transactionsCollection(),
    orderBy("date", "desc")
  );

  unsubscribeTransactions = onSnapshot(
    transactionsQuery,
    (snapshot) => {
      state.transactions = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      renderDashboard();
      renderTransactions();
      renderAnalytics();
    },
    (error) => {
      showToast(firebaseError(error), "error");
    }
  );

  unsubscribePreferences = onSnapshot(
    preferencesDoc(),
    (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();

        state.preferences = {
          monthlyBudget: Number(data.monthlyBudget) || 0,
          theme: data.theme === "dark" ? "dark" : "light"
        };

        localStorage.setItem("rma_theme", state.preferences.theme);
        applyTheme(state.preferences.theme);

        renderDashboard();
        renderAnalytics();
      }
    },
    (error) => {
      console.warn("Preferences listener:", error);
    }
  );
}

/* =========================================================
   BALANCE CALCULATION
========================================================= */

function calculateAccountBalance(accountId) {
  const account = state.accounts.find((item) => item.id === accountId);

  if (!account) return 0;

  let balance = Number(account.openingBalance) || 0;

  for (const transaction of state.transactions) {
    const amount = Number(transaction.amount) || 0;

    if (transaction.type === "income") {
      if (transaction.accountId === accountId) {
        balance += amount;
      }
    }

    if (transaction.type === "expense") {
      if (transaction.accountId === accountId) {
        balance -= amount;
      }
    }

    if (transaction.type === "transfer") {
      if (transaction.sourceAccountId === accountId) {
        balance -= amount;
      }

      if (transaction.destinationAccountId === accountId) {
        balance += amount;
      }
    }
  }

  return balance;
}

function calculateAllBalances() {
  const result = {};

  for (const account of state.accounts) {
    result[account.id] = calculateAccountBalance(account.id);
  }

  return result;
}

function totalCurrentBalance() {
  return state.accounts.reduce(
    (total, account) => total + calculateAccountBalance(account.id),
    0
  );
}

/* =========================================================
   TRANSACTION CALCULATIONS
========================================================= */

function isInDateRange(dateString, period) {
  const date = new Date(`${dateString}T00:00:00`);
  const now = new Date();

  if (period === "all") return true;

  if (period === "week") {
    const currentDay = now.getDay();
    const diff = currentDay === 0 ? 6 : currentDay - 1;

    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(now.getDate() - diff);

    return date >= start;
  }

  if (period === "month") {
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth()
    );
  }

  if (period === "year") {
    return date.getFullYear() === now.getFullYear();
  }

  return true;
}

function expenseTotal(period = null) {
  return state.transactions
    .filter((transaction) => {
      if (transaction.type !== "expense") return false;

      return period
        ? isInDateRange(transaction.date, period)
        : true;
    })
    .reduce((total, transaction) => {
      return total + Number(transaction.amount || 0);
    }, 0);
}

function incomeTotal(period = null) {
  return state.transactions
    .filter((transaction) => {
      if (transaction.type !== "income") return false;

      return period
        ? isInDateRange(transaction.date, period)
        : true;
    })
    .reduce((total, transaction) => {
      return total + Number(transaction.amount || 0);
    }, 0);
}

function getTodayExpense() {
  const today = todayString();

  return state.transactions
    .filter(
      (transaction) =>
        transaction.type === "expense" &&
        transaction.date === today
    )
    .reduce((sum, transaction) => {
      return sum + Number(transaction.amount || 0);
    }, 0);
}

function getCurrentMonthExpense() {
  return expenseTotal("month");
}

function getCurrentWeekExpense() {
  return expenseTotal("week");
}

/* =========================================================
   DASHBOARD
========================================================= */

function renderDashboard() {
  if (!state.user) return;

  const name =
    state.user.displayName ||
    state.user.email?.split("@")[0] ||
    "User";

  $("userGreeting").textContent = `${name} 👋`;
  $("userAvatar").textContent = name.charAt(0).toUpperCase();

  $("totalBalance").textContent = rupees(totalCurrentBalance());

  const totalIncome = incomeTotal();
  const totalExpense = expenseTotal();

  $("totalIncome").textContent = rupees(totalIncome);
  $("totalExpense").textContent = rupees(totalExpense);
  $("todayExpense").textContent = rupees(getTodayExpense());
  $("monthExpense").textContent = rupees(getCurrentMonthExpense());

  renderAccountCards();
  renderBudget();
  renderSmartInsights();
  renderRecentTransactions();
}

function renderAccountCards() {
  const container = $("accountCards");
  const balances = calculateAllBalances();

  if (!state.accounts.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>No accounts</strong>
        Add an account from Manage.
      </div>
    `;
    return;
  }

  container.innerHTML = state.accounts
    .map((account) => `
      <div class="account-card">
        <span class="account-name">${escapeHtml(account.name)}</span>
        <strong class="account-balance">${rupees(balances[account.id] || 0)}</strong>
      </div>
    `)
    .join("");
}

function renderBudget() {
  const budget = Number(state.preferences.monthlyBudget) || 0;
  const spent = getCurrentMonthExpense();

  $("budgetAmount").textContent = rupees(budget);
  $("budgetSpent").textContent = rupees(spent);

  if (budget <= 0) {
    $("budgetProgress").style.width = "0%";
    $("budgetProgress").className = "progress-fill";
    $("budgetPercent").textContent = "No budget set";
    $("budgetRemaining").textContent = "Set a monthly budget";
    $("budgetWarning").classList.add("hidden");
    return;
  }

  const percentage = (spent / budget) * 100;
  const visiblePercentage = Math.min(percentage, 100);

  $("budgetProgress").style.width = `${visiblePercentage}%`;
  $("budgetPercent").textContent = `${percentage.toFixed(0)}% used`;

  const remaining = budget - spent;

  $("budgetRemaining").textContent =
    remaining >= 0
      ? `${rupees(remaining)} remaining`
      : `${rupees(Math.abs(remaining))} over`;

  const progress = $("budgetProgress");