import {
  friendlyAuthError,
  loadOwnProfile,
  loginWithEmail,
  logout,
  observeAuthState,
  registerGuard,
  reloadCurrentUser,
  sendPasswordReset,
  sendVerification
} from "./auth.js";
import { clearAvailabilityCache, loadOwnAvailability } from "./availability.js";
import { initCalendar, showCalendar } from "./calendar.js";
import { disableAdminScreen } from "./admin.js";

const el = {};
let toastTimer;

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  disableAdminScreen(el);
  initCalendar(el, showToast);
  bindEvents();
  observeAuthState(handleAuthState);
});

function cacheElements() {
  [
    "loginScreen", "registerScreen", "verifyEmailScreen", "calendarScreen", "adminScreen",
    "loginMessage", "registerMessage", "verifyEmailMessage", "loginEmail", "loginPassword",
    "loginButton", "showRegisterButton", "resetPasswordButton", "regGuardId", "regName",
    "regEmail", "regZip", "regPref", "regCity", "regStreet", "regBuilding", "regNearestStation",
    "regPassword", "regPasswordConfirm", "registerButton", "backLoginButton",
    "checkVerificationButton", "resendVerificationButton", "verifyLogoutButton",
    "currentUserName", "currentUserId", "logoutButton", "prevMonthButton", "nextMonthButton",
    "todayButton", "monthLabel", "calendarGrid", "shiftModalBackdrop", "modalTitle",
    "modalLockNote", "choiceDay", "choiceNight", "choiceUnavailable", "choiceUndecided",
    "shiftNote", "saveShiftButton", "closeShiftButton", "toast"
  ].forEach(id => { el[id] = document.getElementById(id); });
}

function bindEvents() {
  el.loginButton.addEventListener("click", login);
  el.loginPassword.addEventListener("keydown", event => { if (event.key === "Enter") login(); });
  el.showRegisterButton.addEventListener("click", () => showScreen("register"));
  el.backLoginButton.addEventListener("click", () => showScreen("login"));
  el.resetPasswordButton.addEventListener("click", resetPassword);
  el.registerButton.addEventListener("click", register);
  el.logoutButton.addEventListener("click", signOutUser);
  el.verifyLogoutButton.addEventListener("click", signOutUser);
  el.checkVerificationButton.addEventListener("click", checkVerification);
  el.resendVerificationButton.addEventListener("click", resendVerification);
}

async function handleAuthState(user) {
  clearMessages();
  clearAvailabilityCache();
  if (!user) {
    showScreen("login");
    return;
  }
  el.loginEmail.value = user.email || "";
  if (!user.emailVerified) {
    showScreen("verify");
    showMessage(el.verifyEmailMessage, `${user.email} 宛ての確認メールをご確認ください。`, false);
    return;
  }
  try {
    const profile = await loadOwnProfile(user);
    if (profile.accountStatus !== "active") {
      showScreen("login");
      showMessage(el.loginMessage, "このアカウントは現在利用できません。管理者へ連絡してください。", true);
      await logout();
      return;
    }
    await loadOwnAvailability(user.uid);
    showScreen("calendar");
    showCalendar(profile);
  } catch (error) {
    console.error(error);
    showScreen("login");
    showMessage(el.loginMessage, error.message || "利用者情報を読み込めませんでした。", true);
  }
}

async function login() {
  clearMessage(el.loginMessage);
  const email = el.loginEmail.value.trim();
  const password = el.loginPassword.value;
  if (!email || !password) {
    showMessage(el.loginMessage, "メールアドレスとパスワードを入力してください。", true);
    return;
  }
  await runButtonTask(el.loginButton, async () => {
    try {
      await loginWithEmail(email, password);
      showToast("ログインしました。");
    } catch (error) {
      showMessage(el.loginMessage, friendlyAuthError(error), true);
    }
  });
}

async function register() {
  clearMessage(el.registerMessage);
  const form = {
    employeeNumber: el.regGuardId.value.trim(),
    name: el.regName.value.trim(),
    email: el.regEmail.value.trim(),
    postalCode: el.regZip.value.replace(/\D/g, ""),
    prefecture: el.regPref.value.trim(),
    city: el.regCity.value.trim(),
    addressLine: el.regStreet.value.trim(),
    building: el.regBuilding.value.trim(),
    nearestStation: el.regNearestStation.value.trim(),
    password: el.regPassword.value
  };
  const errors = validateRegistration(form, el.regPasswordConfirm.value);
  if (errors.length) {
    showMessage(el.registerMessage, errors.join(" / "), true);
    return;
  }
  await runButtonTask(el.registerButton, async () => {
    try {
      await registerGuard(form);
      showScreen("verify");
      showMessage(el.verifyEmailMessage, "登録できました。確認メールを送信しました。", false);
    } catch (error) {
      showMessage(el.registerMessage, friendlyAuthError(error), true);
    }
  });
}

function validateRegistration(form, confirmation) {
  const errors = [];
  if (!/^\d{6}$/.test(form.employeeNumber)) errors.push("警備員番号は6桁で入力してください");
  if (!form.name || form.name.length > 80) errors.push("氏名を80文字以内で入力してください");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.push("正しいメールアドレスを入力してください");
  if (!/^\d{7}$/.test(form.postalCode)) errors.push("郵便番号は7桁で入力してください");
  if (!form.prefecture || !form.city || !form.addressLine) errors.push("住所を入力してください");
  if (form.password.length < 6) errors.push("パスワードは6文字以上で入力してください");
  if (form.password !== confirmation) errors.push("パスワードが一致していません");
  return errors;
}

async function resetPassword() {
  clearMessage(el.loginMessage);
  const email = el.loginEmail.value.trim();
  if (!email) {
    showMessage(el.loginMessage, "先にメールアドレスを入力してください。", true);
    el.loginEmail.focus();
    return;
  }
  await runButtonTask(el.resetPasswordButton, async () => {
    try {
      await sendPasswordReset(email);
      showMessage(el.loginMessage, "パスワード再設定メールを送信しました。", false);
    } catch (error) {
      showMessage(el.loginMessage, friendlyAuthError(error), true);
    }
  });
}

async function checkVerification() {
  await runButtonTask(el.checkVerificationButton, async () => {
    const user = await reloadCurrentUser();
    if (user?.emailVerified) {
      await handleAuthState(user);
      showToast("メールアドレスを確認できました。");
    } else {
      showMessage(el.verifyEmailMessage, "まだ確認できません。メール内のリンクを押してください。", true);
    }
  });
}

async function resendVerification() {
  await runButtonTask(el.resendVerificationButton, async () => {
    try {
      await sendVerification();
      showMessage(el.verifyEmailMessage, "確認メールをもう一度送信しました。", false);
    } catch (error) {
      showMessage(el.verifyEmailMessage, friendlyAuthError(error), true);
    }
  });
}

async function signOutUser() {
  try {
    await logout();
    el.loginPassword.value = "";
    showToast("ログアウトしました。");
  } catch (error) {
    showToast(friendlyAuthError(error));
  }
}

async function runButtonTask(button, task) {
  button.disabled = true;
  try {
    await task();
  } catch (error) {
    console.error(error);
    showToast("処理に失敗しました。");
  } finally {
    button.disabled = false;
  }
}

function showScreen(name) {
  const screens = {
    login: el.loginScreen,
    register: el.registerScreen,
    verify: el.verifyEmailScreen,
    calendar: el.calendarScreen
  };
  [el.loginScreen, el.registerScreen, el.verifyEmailScreen, el.calendarScreen, el.adminScreen]
    .forEach(screen => screen?.classList.remove("active"));
  screens[name]?.classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showMessage(target, text, isError) {
  target.textContent = text;
  target.className = `message show ${isError ? "error" : "success"}`;
}

function clearMessage(target) {
  target.textContent = "";
  target.className = "message";
}

function clearMessages() {
  [el.loginMessage, el.registerMessage, el.verifyEmailMessage].forEach(clearMessage);
}

function showToast(text) {
  clearTimeout(toastTimer);
  el.toast.textContent = text;
  el.toast.classList.add("show");
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 3200);
}
