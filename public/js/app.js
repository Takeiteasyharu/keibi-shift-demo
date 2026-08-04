import { loadOwnProfile, loginWithEmployeeNumber, logout, observeAuthState, observeOwnRole, registerGuard, removeLegacyAdminBranch } from "./auth.js?v=20260803-1";
import { clearAvailabilityCache, loadOwnAvailability } from "./availability.js?v=20260803-8";
import { initCalendar, resetCalendarState, setConfirmedShifts, showCalendar } from "./calendar.js?v=20260803-13";
import { initAdmin, loadStaffRequests, removeInactiveAccountFromAdmin, reviewStaffRequest, showAdmin, stopAdminObserver } from "./admin.js?v=20260804-5";
import { initShifts, loadOwnConfirmedShifts, stopShiftGroupObserver } from "./shifts.js?v=20260803-1";
import { createIntegratedWorkerMenu, initGuardManagement, setGuardManagementContext, showDeletedAccounts, showGuardManagement } from "./guard-management.js?v=20260803-6";
import { initProxyInput, showProxyWorkerList } from "./proxy-input.js?v=20260803-1";
import { initShiftConfirmation, stopOwnShiftsObserver } from "./shift-confirmation.js?v=20260804-4";
import { initShiftProgress, showDailyProgress, showDepartureContact, stopDepartureProgressObservers } from "./shift-progress.js?v=20260804-6";
import { initAccountApprovals, showAccountApprovals, stopAccountApprovals } from "./account-approvals.js?v=20260801-2";
import { ALL_BRANCHES, branchName, effectiveBranchId, ensureBranchDocuments, getAdminSelectedBranchId, isOperationalAccount, populateBranchSelect, setAdminSelectedBranchId } from "./branches.js?v=20260801-1";

const el = {};
let toastTimer;
let profile;
let roleData;
let stopRoleObserver;
let registrationInProgress = false;
let showShiftBuilder;
let pendingWebProxyResolve;
let authSessionVersion = 0;
let activeAuthUid = "";

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  initAdmin(el, showScreen, createIntegratedWorkerMenu, showToast);
  initCalendar(el, showToast);
  showShiftBuilder = initShifts(el, showScreen, showToast);
  initGuardManagement(el, showScreen, showToast, openProxyCalendar, async (worker, accountStatus) => {
    removeInactiveAccountFromAdmin(worker, accountStatus);
    await showAdmin(profile, roleData);
  });
  initProxyInput(el, showScreen, openProxyCalendar);
  initShiftConfirmation(el, showScreen);
  initShiftProgress(el, showScreen, showToast);
  initAccountApprovals(el, showScreen);
  populateBranchSelect(el.regRequestedBranch);
  populateBranchSelect(el.adminBranchSwitch, { includeAll: true });
  el.adminBranchSwitch.value = getAdminSelectedBranchId();
  bindEvents();
  observeAuthState(handleAuthState);
});

function cacheElements() {
  ["loginScreen","registerScreen","pendingApprovalScreen","rejectedAccountScreen","calendarScreen","adminScreen","staffRequestsScreen","accountApprovalsScreen","guardManagementScreen","deletedAccountsScreen","proxyWorkerScreen","ownShiftsScreen","dailyProgressScreen","departureContactScreen",
   "loginMessage","registerMessage","loginEmployeeNumber","loginPassword","loginButton",
   "showRegisterButton","forgotPasswordButton","regGuardId","regName","regFurigana","regRequestedBranch","regStaffRequested","regZip","regPref","regCity","regStreet","regBuilding","regNearestStation","regPhone","regEmail","regPassword",
   "regPasswordConfirm","pendingLogoutButton","rejectedLogoutButton","rejectedAccountReason",
   "registerButton","backLoginButton","currentUserName","currentUserId","proxyInputBanner","proxyInputTitle","proxyInputEmployeeNumber","proxyInputName","proxyInputMode","proxyInputWarning","exitProxyInputButton",
   "prevMonthButton","nextMonthButton","todayButton","monthLabel","calendarGrid","openAdminButton",
   "adminDateLabel","adminDate","adminSearch","adminSearchButton","adminClearButton","adminFilters","adminKanaPages",
   "adminTableHead","adminTableBody","adminCards","adminPrevDay","adminToday","adminNextDay",
   "menuButton","requestsMenuButton","accountApprovalsMenuButton","guardManagementMenuButton","deletedAccountsMenuButton","proxyWorkerMenuButton","ownShiftsMenuButton","dailyProgressMenuButton","sideMenuBackdrop","sideMenu","closeMenuButton",
   "menuAdminButton","menuCalendarButton","menuDepartureContactButton","menuDailyProgressButton","applicationsMenuGroup","menuRequestsButton","menuAccountApprovalsButton","adminBranchSwitchWrap","adminBranchSwitch","menuLogoutButton",
   "guardManagementMessage","newManagedGuardButton","openDeletedAccountsButton","backToGuardManagementButton","guardManagementSearch","guardManagementTableBody","guardManagementCards",
   "deletedAccountsMessage","deletedAccountsTableBody","deletedAccountsCards","accountStatusConfirmModal","accountStatusConfirmTitle","accountStatusConfirmMessage","confirmAccountStatusButton","cancelAccountStatusButton",
   "managedGuardModal","managedGuardModalTitle","managedGuardFormMessage","managedGuardEmployeeNumber","managedGuardName","managedGuardFurigana","managedGuardPhone",
   "managedGuardPostalCode","managedGuardPrefecture","managedGuardCity","managedGuardAddressLine","managedGuardBuilding",
   "managedGuardNearestStation","managedGuardContactEmailLabel","managedGuardContactEmail","saveManagedGuardButton","cancelManagedGuardButton",
   "managedGuardFixedInputMode","managedGuardFixedRole","managedGuardFixedStatus","managedGuardLastUpdate",
   "webProfileEditConfirmModal","webProfileEditConfirmMessage","cancelWebProfileEditButton","confirmWebProfileEditButton",
   "profileSaveConfirmModal","profileSaveConfirmMessage","cancelProfileSaveButton","confirmProfileSaveButton",
   "webProxyConfirmModal","webProxyConfirmMessage","cancelWebProxyButton","startWebProxyButton",
   "proxyReasonModal","proxyReasonStep","proxyConfirmStep","proxyUpdateReason","proxyUpdateReasonNoteWrap","proxyUpdateReasonNote","proxyReasonMessage","cancelProxyReasonButton","continueProxyReasonButton","proxySaveConfirmation","backProxyReasonButton","confirmProxySaveButton",
   "staffRequestsList","staffRequestsMessage","shiftBuilderScreen","shiftBuilderMenuButton","menuShiftBuilderButton",
   "accountApprovalsMessage","accountApprovalsTableBody","accountApprovalsCards","accountRejectionModal","accountRejectionTarget","accountRejectionReason","accountRejectionMessage","cancelAccountRejectionButton","confirmAccountRejectionButton",
   "proxyWorkerMessage","proxyWorkerSearch","proxyWorkerTableBody","proxyWorkerCards",
   "ownShiftsMessage","ownShiftsList","pastShiftsList","loadMorePastShiftsButton","ownShiftDetailModal","ownShiftDetailTitle","ownShiftDetailBody","closeOwnShiftDetailButton",
   "shiftMembersModal","shiftMembersTitle","shiftMembersSummary","shiftMembersList","closeShiftMembersButton",
   "dailyProgressMessage","progressDate","progressShiftType","progressFilters","dailyProgressTableBody","dailyProgressCards","departureContactMessage","departureContactList","departureContactMenuButton",
   "departureTimeModal","departureTimeTitle","timeInputLegend","departureHourInput","departureMinuteInput","departureTimeMessage","cancelDepartureTimeButton","confirmDepartureTimeButton",
   "progressActionConfirmModal","progressActionConfirmTitle","progressActionConfirmMessage","confirmProgressActionButton","cancelProgressActionButton",
   "shiftPrevDay","shiftNextDay","shiftToday","shiftBuilderDate","shiftTypeDay","shiftTypeNight","shiftBuilderMessage","shiftGroupsList","newShiftGroupButton","otherBranchCandidatesOption","showOtherBranchCandidates",
   "shiftGroupModal","shiftGroupModalTitle","shiftGroupBranchWrap","shiftGroupBranch","shiftGroupTitle","shiftAddress","shiftStartHour","shiftStartMinute","shiftDepartureCheckTime","shiftRequiredMembers","requiredMembersPickerButton","requiredMembersOptions","shiftGroupNote","memberSearch","memberCandidatesToggle","memberCandidates","showOutsideAvailability","selectedMembersList","leaderChoices","clearLeaderButton","groupCompletionMessage","draftShiftTopButton","confirmShiftTopButton","closeShiftGroupTopButton","draftShiftButton","confirmShiftButton","closeShiftGroupButton","availabilityNotePanel","closeAvailabilityNotePanel","availabilityNoteFullText",
   "shiftDateActionModal","shiftDateActionTitle","shiftDateActionHelp","shiftDateActionInput","shiftDateActionError","saveShiftDateActionButton","cancelShiftDateActionButton",
   "shiftOperationConfirmModal","shiftOperationConfirmTitle","shiftOperationConfirmMessage","confirmShiftOperationButton","cancelShiftOperationButton",
   "shiftModalBackdrop","modalTitle","modalLockNote","confirmedShiftDetails","availabilityAudit",
   "choiceDay","choiceNight","choiceBoth","choiceUnavailable","shiftNote","saveShiftButton",
   "closeShiftButton","toast"].forEach(id => { el[id] = document.getElementById(id); });
}

function bindEvents() {
  el.loginButton.addEventListener("click", login);
  el.loginPassword.addEventListener("keydown", event => { if (event.key === "Enter") login(); });
  el.showRegisterButton.addEventListener("click", () => showScreen("register"));
  el.backLoginButton.addEventListener("click", () => showScreen("login"));
  el.forgotPasswordButton.addEventListener("click", () =>
    showMessage(el.loginMessage, "パスワードを忘れた場合は、国分寺支社の内勤者へ連絡してください。", false));
  el.registerButton.addEventListener("click", register);
  el.pendingLogoutButton.addEventListener("click", signOutUser);
  el.rejectedLogoutButton.addEventListener("click", signOutUser);
  el.openAdminButton.addEventListener("click", openMenu);
  [el.menuButton, el.requestsMenuButton, el.accountApprovalsMenuButton, el.shiftBuilderMenuButton, el.guardManagementMenuButton, el.deletedAccountsMenuButton, el.proxyWorkerMenuButton, el.ownShiftsMenuButton, el.dailyProgressMenuButton, el.departureContactMenuButton]
    .forEach(button => button.addEventListener("click", openMenu));
  el.closeMenuButton.addEventListener("click", closeMenu);
  el.sideMenuBackdrop.addEventListener("click", event => { if (event.target === el.sideMenuBackdrop) closeMenu(); });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    closeMenu();
    if (el.webProxyConfirmModal.classList.contains("show")) closeWebProxyConfirm(false);
  });
  el.menuAdminButton.addEventListener("click", async () => { closeMenu(); await showAdmin(profile, roleData); });
  el.menuShiftBuilderButton.addEventListener("click", async () => { closeMenu(); await showShiftBuilder(profile, roleData); });
  el.menuDailyProgressButton.addEventListener("click", async () => {
    closeMenu();
    await showDailyProgress(profile, roleData);
  });
  el.menuDepartureContactButton.addEventListener("click", () => {
    closeMenu();
    showDepartureContact(profile);
  });
  el.menuCalendarButton.addEventListener("click", async () => {
    closeMenu();
    const expectedProfile = profile;
    const expectedVersion = authSessionVersion;
    if (!expectedProfile || !isCurrentAuthSession(expectedProfile.uid, expectedVersion)) return;
    resetCalendarState();
    const loaded = await loadOwnAvailability(expectedProfile.uid);
    if (!loaded || !isCurrentAuthSession(expectedProfile.uid, expectedVersion)) return;
    const confirmedShifts = await loadOwnConfirmedShifts(expectedProfile.uid, expectedProfile.branchId);
    if (!isCurrentAuthSession(expectedProfile.uid, expectedVersion)) return;
    setConfirmedShifts(confirmedShifts);
    showScreen("calendar");
    showCalendar(expectedProfile);
  });
  el.menuRequestsButton.addEventListener("click", async () => { closeMenu(); await showRequests(); });
  el.menuAccountApprovalsButton.addEventListener("click", () => { closeMenu(); showAccountApprovals(profile, roleData); });
  el.adminBranchSwitch.addEventListener("change", () => {
    const previousBranchId = getAdminSelectedBranchId();
    const nextBranchId = el.adminBranchSwitch.value;
    const accepted = window.confirm(
      "本当に支社を切り替えますか？\n\n切替後はサイトが自動でリロードされます。"
    );
    if (!accepted) {
      el.adminBranchSwitch.value = previousBranchId;
      return;
    }
    setAdminSelectedBranchId(nextBranchId);
    closeMenu();
    window.location.reload();
  });
  el.menuLogoutButton.addEventListener("click", signOutUser);
  el.cancelWebProxyButton.addEventListener("click", () => closeWebProxyConfirm(false));
  el.startWebProxyButton.addEventListener("click", () => closeWebProxyConfirm(true));
  el.webProxyConfirmModal.addEventListener("click", event => {
    if (event.target === el.webProxyConfirmModal) closeWebProxyConfirm(false);
  });
}

async function handleAuthState(user) {
  if (registrationInProgress) return;
  const sessionVersion = ++authSessionVersion;
  activeAuthUid = user?.uid || "";
  stopRoleObserver?.();
  stopRoleObserver = null;
  stopShiftGroupObserver();
  stopOwnShiftsObserver();
  clearAvailabilityCache();
  resetCalendarState();
  setConfirmedShifts([]);
  profile = null;
  roleData = null;
  if (!user) { showScreen("login"); return; }
  try {
    const nextProfile = await loadOwnProfile(user);
    if (!isCurrentAuthSession(user.uid, sessionVersion)) return;
    profile = nextProfile;
    stopRoleObserver = observeOwnRole(user.uid, async nextRole => {
      if (!isCurrentAuthSession(user.uid, sessionVersion)) return;
      await handleRoleChange(nextRole, user.uid, sessionVersion);
    }, async error => {
      if (!isCurrentAuthSession(user.uid, sessionVersion)) return;
      console.error(error); await signOutUser();
    });
  } catch (error) {
    console.error(error); await signOutUser();
    showMessage(el.loginMessage, "利用者情報を読み込めませんでした。", true);
  }
}

async function handleRoleChange(nextRole, expectedUid = activeAuthUid, sessionVersion = authSessionVersion) {
  if (!isCurrentAuthSession(expectedUid, sessionVersion) || profile?.uid !== expectedUid) return;
  if (!nextRole) {
    await signOutUser();
    showMessage(el.loginMessage, "このアカウントは現在利用できません。国分寺支社へお問い合わせください。", true);
    return;
  }
  roleData = nextRole;
  if (nextRole.role === "admin" && Object.hasOwn(nextRole, "branchId")) {
    delete profile.branchId;
    await removeLegacyAdminBranch(profile.uid);
    return;
  }
  if (nextRole.accountStatus === "pending") {
    stopAccountApprovals();
    showScreen("pendingApproval");
    return;
  }
  if (nextRole.accountStatus === "rejected") {
    stopAccountApprovals();
    el.rejectedAccountReason.textContent = nextRole.rejectionReason ? `却下理由：${nextRole.rejectionReason}` : "";
    showScreen("rejectedAccount");
    return;
  }
  if (!isOperationalAccount(nextRole.accountStatus)) {
    await signOutUser();
    showMessage(el.loginMessage, "このアカウントは現在利用できません。管理者へお問い合わせください。", true);
    return;
  }
  setGuardManagementContext(profile, roleData);
  const isOffice = ["staff", "admin"].includes(roleData.role);
  if (roleData.role === "admin") await ensureBranchDocuments();
  el.openAdminButton.hidden = false;
  el.menuAdminButton.hidden = !isOffice;
  el.menuShiftBuilderButton.hidden = !isOffice;
  el.menuRequestsButton.hidden = !isOffice;
  el.menuDailyProgressButton.hidden = !isOffice;
  el.menuDepartureContactButton.hidden = false;
  el.applicationsMenuGroup.hidden = roleData.role !== "admin";
  el.menuAccountApprovalsButton.hidden = roleData.role !== "admin";
  el.adminBranchSwitchWrap.hidden = roleData.role !== "admin";
  el.otherBranchCandidatesOption.hidden = roleData.role !== "staff";
  el.menuCalendarButton.textContent = isOffice ? "自分の勤務希望" : "勤務希望入力";
  if (isOffice) await showAdmin(profile, roleData);
  else {
    resetCalendarState();
    const loaded = await loadOwnAvailability(expectedUid, profile.branchId);
    if (!loaded || !isCurrentAuthSession(expectedUid, sessionVersion)) return;
    const confirmedShifts = await loadOwnConfirmedShifts(expectedUid, profile.branchId);
    if (!isCurrentAuthSession(expectedUid, sessionVersion)) return;
    setConfirmedShifts(confirmedShifts);
    showScreen("calendar");
    showCalendar(profile);
  }
}

async function login() {
  const employeeNumber = el.loginEmployeeNumber.value.trim();
  const password = el.loginPassword.value;
  if (!/^\d{6}$/.test(employeeNumber) || !password) {
    showMessage(el.loginMessage, "警備員番号またはパスワードが正しくありません。", true); return;
  }
  await runButtonTask(el.loginButton, async () => {
    try { await loginWithEmployeeNumber(employeeNumber, password); }
    catch { showMessage(el.loginMessage, "警備員番号またはパスワードが正しくありません。", true); }
  });
}

async function register() {
  const form = {
    employeeNumber: el.regGuardId.value.trim(), name: el.regName.value.trim(),
    furigana: el.regFurigana.value.trim(),
    requestedBranchId: el.regRequestedBranch.value,
    postalCode: el.regZip.value.replace(/\D/g, ""),
    prefecture: el.regPref.value.trim(), city: el.regCity.value.trim(),
    addressLine: el.regStreet.value.trim(), building: el.regBuilding.value.trim(),
    nearestStation: el.regNearestStation.value.trim(),
    phone: el.regPhone.value.trim(), contactEmail: el.regEmail.value.trim().toLowerCase(),
    staffRequested: el.regStaffRequested.checked,
    password: el.regPassword.value
  };
  const errors = validateRegistration(form, el.regPasswordConfirm.value);
  if (errors.length) { showMessage(el.registerMessage, errors.join(" / "), true); return; }
  await runButtonTask(el.registerButton, async () => {
    registrationInProgress = true;
    try {
      const user = await registerGuard(form);
      registrationInProgress = false;
      await handleAuthState(user);
      showToast("登録しました。");
    }
    catch (error) {
      registrationInProgress = false;
      console.error(error);
      const message = error?.code === "auth/email-already-in-use"
        ? "この警備員番号のログイン用アカウントがFirebase Authenticationに残っています。管理者へ確認してください。"
        : error?.registrationStage === "firestoreReservation"
          ? "この警備員番号は利用中・承認待ち・利用停止中、または番号予約データが残っています。管理者へ確認してください。"
          : "登録できませんでした。時間をおいてもう一度お試しください。";
      showMessage(el.registerMessage, message, true);
    }
  });
}

function validateRegistration(form, confirmation) {
  const errors = [];
  if (!/^\d{6}$/.test(form.employeeNumber)) errors.push("警備員番号は6桁で入力してください");
  if (!form.name || form.name.length > 80) errors.push("氏名を80文字以内で入力してください");
  if (!form.furigana) errors.push("ふりがなを入力してください");
  else if (form.furigana.length > 80 || !/^[ぁ-んァ-ヶー・\s]+$/u.test(form.furigana)) {
    errors.push("ふりがなは、ひらがなまたはカタカナで入力してください");
  }
  if (!["kokubunji", "mitaka"].includes(form.requestedBranchId)) errors.push("希望所属支社を選択してください");
  if (form.postalCode && !/^\d{7}$/.test(form.postalCode)) errors.push("郵便番号は7桁で入力してください");
  if (!form.prefecture || !form.city || !form.addressLine) errors.push("住所を入力してください");
  if (form.prefecture.length > 20 || form.city.length > 80 || form.addressLine.length > 160 || form.building.length > 160) {
    errors.push("住所が長すぎます");
  }
  if (!form.nearestStation) errors.push("最寄り駅を入力してください");
  else if (form.nearestStation.length > 80) errors.push("最寄り駅は80文字以内で入力してください");
  const phoneDigits = form.phone.replace(/\D/g, "");
  if (!form.phone) errors.push("電話番号を入力してください");
  else if (!/^[0-9+\-() 　]+$/.test(form.phone) || phoneDigits.length < 9 || phoneDigits.length > 11) {
    errors.push("電話番号の形式を確認してください");
  }
  if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) {
    errors.push("メールアドレスの形式を確認してください");
  }
  if (form.password.length < 6) errors.push("パスワードは6文字以上で入力してください");
  if (form.password !== confirmation) errors.push("パスワードが一致していません");
  return errors;
}

async function showRequests() {
  showScreen("requests");
  el.staffRequestsList.replaceChildren();
  try {
    const requests = await loadStaffRequests();
    requests.forEach(item => {
      const card = document.createElement("article");
      card.className = "request-card";
      const date = item.createdAt?.toDate?.().toLocaleString("ja-JP") || "―";
      card.innerHTML = `<div><b>警備員番号：</b>${escapeHtml(item.employeeNumber)}</div>
        <div><b>氏名：</b>${escapeHtml(item.name)}</div><div><b>所属支社：</b>${escapeHtml(branchName(item.branchId))}</div>
        <div><b>申請日時：</b>${escapeHtml(date)}</div><div><b>現在の状態：</b>${escapeHtml(item.status)}</div>`;
      if (item.status === "pending" && roleData?.role === "admin") {
        const actions = document.createElement("div"); actions.className = "request-actions";
        const requestButtons = [];
        [["承認","approved"],["却下","rejected"]].forEach(([label, decision]) => {
          const button = document.createElement("button"); button.textContent = label;
          if (decision === "rejected") button.className = "secondary";
          button.addEventListener("click", async () => {
            requestButtons.forEach(itemButton => { itemButton.disabled = true; });
            button.textContent = "処理中...";
            try {
              await reviewStaffRequest(item, decision);
              await showRequests();
              showMessage(el.staffRequestsMessage,
                decision === "approved" ? "内勤者申請を承認しました。" : "内勤者申請を却下しました。", false);
            } catch (error) {
              console.error(`内勤者申請の${decision === "approved" ? "承認" : "却下"}に失敗しました`, error);
              requestButtons.forEach(itemButton => { itemButton.disabled = false; });
              button.textContent = label;
              showMessage(el.staffRequestsMessage, staffRequestErrorMessage(error), true);
            }
          });
          requestButtons.push(button);
          actions.appendChild(button);
        });
        card.appendChild(actions);
      }
      el.staffRequestsList.appendChild(card);
    });
    if (!requests.length) el.staffRequestsList.innerHTML = '<div class="panel">申請はありません。</div>';
  } catch (error) { console.error(error); showMessage(el.staffRequestsMessage, "申請を読み込めませんでした。", true); }
}

function staffRequestErrorMessage(error) {
  const code = String(error?.code || "").replace("firestore/", "");
  if (code === "permission-denied") return "この操作を実行する権限がありません。";
  if (code === "not-found") return "対象の申請データが見つかりません。";
  if (code === "failed-precondition") return "対象ユーザーの登録情報が不足しています。";
  if (["unavailable", "deadline-exceeded", "network-request-failed"].includes(code)) {
    return "通信に失敗しました。時間をおいて再度お試しください。";
  }
  return "内勤者申請を処理できませんでした。時間をおいて再度お試しください。";
}

async function signOutUser() {
  authSessionVersion += 1;
  activeAuthUid = "";
  closeMenu(); stopAccountApprovals(); stopRoleObserver?.(); stopRoleObserver = null;
  stopShiftGroupObserver();
  stopOwnShiftsObserver();
  clearAvailabilityCache(); resetCalendarState(); setConfirmedShifts([]);
  profile = null; roleData = null;
  await logout(); el.loginPassword.value = ""; showToast("ログアウトしました。");
}

function isCurrentAuthSession(uid, sessionVersion) {
  return Boolean(uid) && activeAuthUid === uid && authSessionVersion === sessionVersion;
}
function openMenu() {
  if (!isOperationalAccount(roleData?.accountStatus)) return;
  el.sideMenu.scrollTop = 0;
  document.body.classList.add("side-menu-open");
  el.sideMenuBackdrop.classList.add("show");
}
function closeMenu() {
  el.sideMenuBackdrop.classList.remove("show");
  document.body.classList.remove("side-menu-open");
  el.sideMenu.scrollTop = 0;
}
function showScreen(name) {
  if (name !== "admin") stopAdminObserver();
  if (name !== "shiftBuilder") stopShiftGroupObserver();
  if (name !== "ownShifts") stopOwnShiftsObserver();
  const screens = {login:el.loginScreen, register:el.registerScreen,
    pendingApproval:el.pendingApprovalScreen, rejectedAccount:el.rejectedAccountScreen,
    calendar:el.calendarScreen,
    admin:el.adminScreen, requests:el.staffRequestsScreen, shiftBuilder:el.shiftBuilderScreen,
    accountApprovals:el.accountApprovalsScreen,
    guardManagement:el.guardManagementScreen, deletedAccounts:el.deletedAccountsScreen,
    proxyWorkers:el.proxyWorkerScreen, ownShifts:el.ownShiftsScreen, dailyProgress:el.dailyProgressScreen,
    departureContact:el.departureContactScreen};
  if (name !== "dailyProgress" && name !== "departureContact") stopDepartureProgressObservers();
  Object.values(screens).forEach(screen => screen?.classList.remove("active"));
  screens[name]?.classList.add("active"); window.scrollTo({top:0, behavior:"smooth"});
}

async function refreshCurrentOfficeScreen() {
  if (el.adminScreen.classList.contains("active")) await showAdmin(profile, roleData);
  else if (el.accountApprovalsScreen.classList.contains("active")) showAccountApprovals(profile, roleData);
  else if (el.staffRequestsScreen.classList.contains("active")) await showRequests();
  else if (el.shiftBuilderScreen.classList.contains("active")) await showShiftBuilder(profile, roleData);
  else if (el.guardManagementScreen.classList.contains("active")) await showGuardManagement(profile, roleData);
  else if (el.deletedAccountsScreen.classList.contains("active")) await showDeletedAccounts();
  else if (el.proxyWorkerScreen.classList.contains("active")) await showProxyWorkerList(profile, roleData);
  else if (el.dailyProgressScreen.classList.contains("active")) await showDailyProgress(profile, roleData);
}
async function openProxyCalendar(worker, returnScreen = "proxyWorkers") {
  if (!canProxyInput(worker)) return;
  const inputMode = worker.inputMode === "managed" ? "managed" : "web";
  if (inputMode === "web" && !await confirmWebProxyStart(worker)) return;
  const operatorUid = profile?.uid;
  const sessionVersion = authSessionVersion;
  resetCalendarState();
  try {
    const loaded = await loadOwnAvailability(worker.id || worker.uid, worker.branchId || roleData.branchId);
    if (!loaded || !isCurrentAuthSession(operatorUid, sessionVersion)) return;
  } catch (error) {
    console.error(error);
    showToast("勤務希望の編集画面を開けませんでした。Firestore Rulesのデプロイ状態を確認してください。");
    return;
  }
  setConfirmedShifts([]);
  showScreen("calendar");
  showCalendar({ ...worker, uid: worker.id || worker.uid }, {
    proxy: true,
    operatorUid,
    operatorName: profile?.name || "",
    operatorRole: roleData.role,
    inputMode,
    returnAction: async () => {
      if (returnScreen === "guardManagement") await showGuardManagement(profile, roleData);
      else if (returnScreen === "admin") await showAdmin(profile, roleData);
      else await showProxyWorkerList(profile, roleData);
    }
  });
}
function canProxyInput(worker) {
  const inputMode = worker?.inputMode === "managed" ? "managed" : "web";
  return ["staff", "admin"].includes(roleData?.role) &&
    ["managed", "web"].includes(inputMode) &&
    isOperationalAccount(worker?.accountStatus) &&
    (roleData.role === "admin" || worker?.branchId === effectiveBranchId(roleData)) &&
    (roleData.role === "admin" || worker?.role !== "admin");
}
function confirmWebProxyStart(worker) {
  el.webProxyConfirmMessage.textContent =
    `この警備員は本人がWebから勤務希望を入力できます。\n` +
    `内勤者が変更すると、本人が入力した内容を上書きする可能性があります。\n\n` +
    `本人から電話・対面などで変更依頼を受けていることを確認してください。\n\n` +
    `対象：\n警備員番号：${worker.employeeNumber}\n氏名：${worker.name}`;
  el.webProxyConfirmModal.classList.add("show");
  return new Promise(resolve => { pendingWebProxyResolve = resolve; });
}
function closeWebProxyConfirm(result) {
  el.webProxyConfirmModal.classList.remove("show");
  const resolve = pendingWebProxyResolve;
  pendingWebProxyResolve = null;
  resolve?.(result);
}
async function runButtonTask(button, task) { button.disabled=true; try { await task(); } finally { button.disabled=false; } }
function showMessage(target, text, error) { target.textContent=text; target.className=`message show ${error?"error":"success"}`; }
function showToast(text) { clearTimeout(toastTimer); el.toast.textContent=text; el.toast.classList.add("show");
  toastTimer=setTimeout(()=>el.toast.classList.remove("show"),3200); }
function escapeHtml(value) { const div=document.createElement("div"); div.textContent=String(value??""); return div.innerHTML; }
