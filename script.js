// --- Theme & Toast Logic ---
const theme = localStorage.getItem('lunch_theme') || 'light';
if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

// --- 雲端配置與全域狀態 ---
const API_URL = "https://script.google.com/macros/s/AKfycbxR4hZVVCkYAWI-Gs_tvwN-q4mOwvYGrVMI3npR6CprPLBAmwR14HH1JuwGOpWZ1Hko/exec";
const CLOUD_CACHE_KEY = 'lunch_cloud_cache';
const SETTINGS_KEY = 'lunch_settings';

let isSyncing = false;
let lastSaveTimestamp = 0;
let memoryOrders = [];
let memoryUsers = [];
let memoryRestaurants = [];
let memoryVotes = [];
let memoryConfig = {};

let lastFetchID = 0;
let lastViewedMeal = '';
let lastViewedDate = '';
let currentUser = null;

function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✅' : (type === 'error' ? '⚠️' : '💡');
    toast.innerHTML = `<span>${icon}</span> <span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('diminish');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showMenuLightbox(src, title) {
    let lightbox = document.getElementById('menu-lightbox');
    if (!lightbox) {
        lightbox = document.createElement('div');
        lightbox.id = 'menu-lightbox';
        lightbox.className = 'modal-overlay';
        lightbox.style.zIndex = '3000';
        lightbox.innerHTML = `
            <div class="modal-content" style="max-width:90%; max-height:90%; padding:1.5rem; position:relative; overflow:hidden; display:flex; flex-direction:column;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                    <h3 id="lightbox-title" style="margin:0;"></h3>
                    <button id="close-lightbox" class="close-btn" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:var(--text-main);">✖</button>
                </div>
                <div style="overflow:auto; flex:1; display:flex; justify-content:center; align-items:flex-start;">
                    <img id="lightbox-img" src="" style="max-width:100%; display:block; border-radius:0.5rem; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
                </div>
            </div>
        `;
        document.body.appendChild(lightbox);
        lightbox.querySelector('#close-lightbox').onclick = () => lightbox.classList.add('hidden');
        lightbox.onclick = (e) => { if (e.target === lightbox) lightbox.classList.add('hidden'); };
    }
    const titleEl = document.getElementById('lightbox-title');
    const imgEl = document.getElementById('lightbox-img');
    if (titleEl) titleEl.innerText = `📄 ${title} 的菜單`;
    if (imgEl) imgEl.src = src;
    lightbox.classList.remove('hidden');
}

function showSyncLoader() {
    document.body.classList.add('sync-active');
}
function hideSyncLoader() {
    document.body.classList.remove('sync-active');
}

document.addEventListener('DOMContentLoaded', () => {
    // --- 核心變數與元素定義 ---
    const appLayout = document.querySelector('.app-layout');
    const excelModal = document.getElementById('excel-modal');
    const settingsModal = document.getElementById('settings-modal');

    const dateInputs = document.querySelectorAll('#order-date, #order-date-mob');
    const mealTypeInputs = document.querySelectorAll('#meal-type, #meal-type-mob');
    const restaurantInputs = document.querySelectorAll('#restaurant-name, #restaurant-name-mob');
    const cutoffInputs = document.querySelectorAll('#cutoff-time, #cutoff-time-mob');

    const personNameInput = document.getElementById('person-name');
    const itemNameInput = document.getElementById('item-name');
    const itemPriceInput = document.getElementById('item-price');
    const submitOrderBtn = document.getElementById('submit-order-btn');

    const authNameInput = document.getElementById('auth-name');
    const authPassInput = document.getElementById('auth-pass');
    const authSubmitBtn = document.getElementById('auth-submit-btn');
    const authSwitchLink = document.getElementById('auth-switch-link');
    const loginTitle = document.getElementById('login-title');
    const loginSubtitle = document.getElementById('login-subtitle');
    const registerNote = document.getElementById('register-note');
    const loginOverlay = document.getElementById('login-overlay');

    let authMode = 'login';
    const orderFormContainer = document.getElementById('order-form-container');
    const lockedWarning = document.getElementById('locked-warning');

    const orderDateInput = document.getElementById('order-date');
    const mealTypeInput = document.getElementById('meal-type');
    const restaurantNameInput = document.getElementById('restaurant-name');
    const cutoffTimeInput = document.getElementById('cutoff-time');

    const currentWeekLabel = document.getElementById('current-week-label');
    let tabBtns = document.querySelectorAll('.tab-btn');
    let currentActiveTab = 'tab-details';
    let currentViewDate = new Date();
    let isSettingsAuthenticated = false;

    const prevWeekBtn = document.getElementById('prev-week-btn');
    const nextWeekBtn = document.getElementById('next-week-btn');
    const currentWeekBtn = document.getElementById('current-week-btn');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const clearHistoryBtn = document.getElementById('clear-history-btn');

    window.openMenuViewer = function (restName) {
        const modal = document.getElementById('menu-viewer-modal');
        const img = document.getElementById('menu-viewer-img');
        const title = document.getElementById('menu-viewer-title');
        const empty = document.getElementById('menu-viewer-empty');
        if (!modal || !img) return;
        const restaurant = memoryRestaurants.find(r => r && r.name && r.name.trim() === restName.trim());
        const imgData = restaurant ? (restaurant.menuImage || restaurant.menuUrl) : null;
        if (imgData) {
            title.textContent = `🍱 ${restaurant ? restaurant.name : restName} - 菜單`;
            img.src = imgData;
            img.classList.remove('hidden');
            empty.classList.add('hidden');
        } else {
            title.textContent = `🍱 ${restaurant ? restaurant.name : restName}`;
            img.src = "";
            img.classList.add('hidden');
            empty.textContent = "⚠️ 此餐廳目前無菜單圖片或連結";
            empty.classList.remove('hidden');
        }
        const closeBtn = modal.querySelector('.modal-close-btn');
        if (closeBtn) closeBtn.innerHTML = '✕';
        modal.classList.remove('hidden');
    };

    window.closeMenuViewer = function () {
        const modal = document.getElementById('menu-viewer-modal');
        if (modal) modal.classList.add('hidden');
    };

    const quickOrderLabels = document.getElementById('quick-order-labels');
    const activeRestCard = document.getElementById('active-restaurant-card');
    const displayRestName = document.getElementById('display-rest-name');
    const displayRestMenu = document.getElementById('display-rest-menu');
    const displayRestPhone = document.getElementById('display-rest-phone');
    const itemHistoryDl = document.getElementById('item-history');

    function safeListen(el, event, cb) { if (el) el.addEventListener(event, cb); }
    function safeListenAll(selector, event, cb) { document.querySelectorAll(selector).forEach(el => el.addEventListener(event, cb)); }

    function syncAndRefresh(inputs, val, refresh = true) {
        inputs.forEach(input => { if (input.value !== val) input.value = val; });
        if (refresh) {
            handleFormState();
            if (typeof updateRestaurantMenuDisplay === 'function') updateRestaurantMenuDisplay();
        }
    }

    function updateDashboardSafely(stats) {
        const elTodayCount = document.getElementById('dash-today-count');
        const elTodayTotal = document.getElementById('dash-today-total');
        const elGrandTotal = document.getElementById('dash-grand-total');
        if (elTodayCount) elTodayCount.innerText = stats.count || 0;
        if (elTodayTotal) elTodayTotal.innerText = stats.total || 0;
        if (elGrandTotal) elGrandTotal.innerText = stats.grandTotal || '$0';
    }

    dateInputs.forEach(el => safeListen(el, 'change', (e) => syncAndRefresh(dateInputs, e.target.value)));
    mealTypeInputs.forEach(el => safeListen(el, 'change', (e) => syncAndRefresh(mealTypeInputs, e.target.value)));
    restaurantInputs.forEach(el => safeListen(el, 'change', (e) => syncAndRefresh(restaurantInputs, e.target.value)));
    safeListenAll('.nav-home-btn', 'click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

    function highlightTab(tabName) {
        currentActiveTab = tabName;
        const allReportTabs = document.querySelectorAll('.tab-btn');
        allReportTabs.forEach(b => {
            if (b.getAttribute('data-tab') === tabName) b.classList.add('active');
            else b.classList.remove('active');
        });
    }

    safeListenAll('.nav-details-btn', 'click', () => {
        highlightTab('tab-details');
        excelModal.classList.remove('hidden');
        renderOrders();
    });

    safeListenAll('.nav-person-btn', 'click', () => {
        highlightTab('tab-person');
        excelModal.classList.remove('hidden');
        renderOrders();
    });

    safeListenAll('.nav-settings-btn', 'click', () => {
        if (!settingsModal) return;
        isSettingsAuthenticated = true;
        document.getElementById('settings-auth-wrapper').style.display = 'none';
        document.getElementById('settings-main-content').style.display = 'block';
        settingsModal.classList.remove('hidden');
        renderSettingsTab();
    });

    const unlockSettings = () => {
        const input = document.getElementById('settings-password-input');
        const errorMsg = document.getElementById('auth-error-msg');
        const corePassword = String(memoryConfig.adminPwd || '1234');
        if (input.value === corePassword) {
            isSettingsAuthenticated = true;
            document.getElementById('settings-auth-wrapper').style.display = 'none';
            document.getElementById('settings-main-content').style.display = 'block';
            renderSettingsTab();
        } else {
            errorMsg.style.display = 'block';
            input.value = '';
            input.focus();
        }
    };

    safeListen(document.getElementById('unlock-settings-btn'), 'click', unlockSettings);
    safeListen(document.getElementById('settings-password-input'), 'keypress', (e) => { if (e.key === 'Enter') unlockSettings(); });

    const updateThemeIcons = (isDark) => {
        document.querySelectorAll('.theme-toggle').forEach(btn => {
            btn.innerHTML = isDark ? '<span>☀️</span>' : '<span>🌙</span>';
        });
    };
    updateThemeIcons(document.documentElement.getAttribute('data-theme') === 'dark');

    safeListenAll('.theme-toggle', 'click', () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (isDark) {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('lunch_theme', 'light');
            updateThemeIcons(false);
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('lunch_theme', 'dark');
            updateThemeIcons(true);
        }
    });

    safeListen(document.getElementById('close-modal-btn'), 'click', () => excelModal.classList.add('hidden'));
    safeListen(document.getElementById('close-settings-btn'), 'click', () => settingsModal.classList.add('hidden'));

    function normalizeDate(raw) {
        if (!raw) return '';
        if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
        try {
            const d = new Date(raw);
            if (!isNaN(d.getTime())) {
                const local = new Date(d.getTime() + 8 * 60 * 60 * 1000);
                return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
            }
        } catch (e) { }
        return String(raw);
    }

    function normalizeTime(raw) {
        if (!raw) return '';
        const str = String(raw);
        if (/^\d{2}:\d{2}$/.test(str)) return str;
        const isoMatch = String(str).match(/T(\d{2}):(\d{2})/);
        if (isoMatch) return `${isoMatch[1]}:${isoMatch[2]}`;
        try {
            const d = new Date(str);
            if (!isNaN(d.getTime())) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        } catch (e) { }
        const match = String(str).match(/(\d{1,2}):(\d{2})/);
        if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
        return '';
    }

    async function fetchFromCloud() {
        if (!API_URL.startsWith("http")) return;
        if (isSyncing) return;
        const currentSyncID = Date.now();
        lastFetchID = currentSyncID;
        const lastSave = parseInt(localStorage.getItem('lunch_last_save') || '0');
        if (Date.now() - lastSave < 5000) return;
        try {
            const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'fetchData' }) });
            if (!res.ok) return;
            const text = await res.text();
            let data;
            try { data = JSON.parse(text); } catch (e) { return; }
            if (isSyncing || lastFetchID !== currentSyncID) return;
            if (data) {
                if (data.orders) {
                    memoryOrders = data.orders.map(o => {
                        if (!o.name && o.userName) o.name = o.userName;
                        o.date = normalizeDate(o.date);
                        o.price = Number(o.price) || 0;
                        o.paid = o.paid === true || o.paid === 'TRUE';
                        o.cutoffTime = normalizeTime(o.cutoffTime);
                        return o;
                    }).filter(o => o.date);
                    memoryUsers = (data.users || []).map(u => {
                        if (!u.name && u.userName) u.name = u.userName;
                        return u;
                    });
                    memoryRestaurants = data.restaurants || [];
                    memoryConfig = {};
                    (data.config || []).forEach(c => { memoryConfig[c.key] = c.value; });
                }
                updateLocalCache();
                updateDatalists();
                updateGrandTotal();
                if (!excelModal.classList.contains('hidden')) renderOrders();
                const sModal = document.getElementById('settings-modal');
                const isUserTyping = sModal && !sModal.classList.contains('hidden') && sModal.contains(document.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
                if (sModal && !sModal.classList.contains('hidden') && !isUserTyping) renderSettingsTab();
            }
            handleFormState();
            toggleRoleUI();
        } catch (err) { console.error("雲端同步失敗", err); }
    }

    function getTodayString() {
        const today = new Date();
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    }

    function getOrders() { return memoryOrders; }

    function updateLocalCache() {
        try {
            localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify({
                orders: memoryOrders, users: memoryUsers, restaurants: memoryRestaurants, config: Object.entries(memoryConfig).map(([key, value]) => ({ key, value }))
            }));
        } catch (e) { }
    }

    async function saveCloudData(action, dataArray) {
        if (!API_URL.startsWith("http")) return;
        isSyncing = true;
        showSyncLoader();
        const payload = JSON.stringify({ action, data: dataArray });
        try {
            const response = await fetch(API_URL, { method: 'POST', body: payload });
            if (!response.ok) throw new Error(`HTTP Error! Status: ${response.status}`);
            const text = await response.text();
            if (text.trim() === "success") return true;
            return true;
        } catch (err) {
            console.error("雲端儲存失敗:", err);
            showToast(`雲端儲存失敗: ${err.message}`, 'error');
            return false;
        } finally {
            isSyncing = false;
            hideSyncLoader();
            lastSaveTimestamp = Date.now();
            localStorage.setItem('lunch_last_save', lastSaveTimestamp);
        }
    }

    function saveOrders(orders, specificAction = "saveOrders", specificData = null) {
        memoryOrders = orders;
        updateDatalists();
        updateLocalCache();
        saveCloudData(specificAction, specificData || orders);
    }

    function saveUsers(users) {
        memoryUsers = users;
        updateLocalCache();
        saveCloudData("saveUsers", users);
        updateDatalists();
    }

    async function saveRestaurants(rests) {
        memoryRestaurants = rests;
        updateLocalCache();
        const success = await saveCloudData("saveRestaurants", rests);
        if (success) updateDatalists();
    }

    function getSettings() {
        const defaultCutoffs = { '午餐': '11:00' };
        try {
            const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
            return { mealCutoffs: s?.mealCutoffs || defaultCutoffs, cutoffTime: s?.cutoffTime || '11:00' };
        } catch (e) { return { mealCutoffs: defaultCutoffs, cutoffTime: '11:00' }; }
    }

    function saveSettings(settings) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

    const initialSettings = getSettings();
    if (initialSettings.cutoffTime) cutoffInputs.forEach(input => { if (input) input.value = initialSettings.cutoffTime; });
    dateInputs.forEach(input => { if (input) input.value = getTodayString(); });

    (function setDefaultMealType() {
        document.querySelectorAll('#meal-type, #meal-type-mob').forEach(sel => { if (sel) sel.value = '午餐'; });
    })();

    function updateDatalists() {
        const orders = getOrders();
        if (personNameInput) {
            const oldName = personNameInput.value;
            personNameInput.innerHTML = '<option value="" disabled selected>請選擇姓名</option>';
            const allNames = [...new Set([...memoryUsers.map(u => u.name), ...(currentUser ? [currentUser.name] : [])])].filter(Boolean);
            allNames.forEach(name => { personNameInput.innerHTML += `<option value="${name}">${name}</option>`; });
            const isAdmin = currentUser && currentUser.role === 'admin';
            if (currentUser && !isAdmin) {
                personNameInput.value = currentUser.name;
                personNameInput.disabled = true;
            } else {
                personNameInput.value = oldName || "";
                personNameInput.disabled = false;
            }
        }
        if (restaurantInputs && restaurantInputs.length > 0) {
            restaurantInputs.forEach(sel => {
                const oldVal = sel.value;
                sel.innerHTML = '<option value="">請選擇餐廳...</option>';
                memoryRestaurants.forEach(r => {
                    const opt = document.createElement('option');
                    opt.value = r.name; opt.textContent = r.name; sel.appendChild(opt);
                });
                sel.value = oldVal;
            });
        }
        if (itemHistoryDl) {
            const items = [...new Set(orders.map(o => o.item).filter(Boolean))];
            itemHistoryDl.innerHTML = '';
            items.forEach(i => { const opt = document.createElement('option'); opt.value = i; itemHistoryDl.appendChild(opt); });
        }
        renderQuickPrices(orders);
    }

    function renderQuickPrices(orders) {
        const quickContainer = document.getElementById('quick-prices-container');
        if (!quickContainer) return;
        const freq = {};
        orders.forEach(o => { freq[o.price] = (freq[o.price] || 0) + 1; });
        const topPrices = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 4).map(Number);
        const displayPrices = topPrices.length >= 3 ? topPrices : [50, 60, 80, 100];
        quickContainer.innerHTML = '';
        displayPrices.forEach(p => {
            const btn = document.createElement('button');
            btn.type = 'button'; btn.className = 'quick-price-btn'; btn.textContent = `+$${p}`;
            btn.addEventListener('click', () => { itemPriceInput.value = p; itemPriceInput.focus(); });
            quickContainer.appendChild(btn);
        });
    }

    itemNameInput.addEventListener('change', () => {
        const typed = itemNameInput.value.trim();
        if (!typed) return;
        const match = getOrders().slice().reverse().find(o => o.item === typed);
        if (match && !itemPriceInput.value) {
            itemPriceInput.value = match.price;
            showToast(`已自動記憶價格：$${match.price}`, 'info');
        }
    });

    function isSessionLocked(dateStr, mealTypeStr) {
        const todayStr = getTodayString();
        if (dateStr < todayStr) return true;
        if (dateStr === todayStr) {
            const activeCutoff = getActiveCutoffTime();
            const now = new Date();
            const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            if (currentTimeStr >= normalizeTime(activeCutoff)) return true;
        }
        return false;
    }

    function getRecommendedRestaurant(date, mealType) {
        const sessionOrders = getOrders().filter(o => o.date === date && o.mealType === mealType);
        if (sessionOrders.length > 0) return { name: sessionOrders[0].restaurant, source: 'order' };
        const cloudRest = memoryConfig[`restaurant_${date}_${mealType}`];
        if (cloudRest) return { name: cloudRest, source: 'cloud' };
        const dayOfMonth = new Date(date + 'T12:00:00').getDate();
        const monthlyRest = memoryConfig[`monthly_${mealType}_${dayOfMonth}`] || '';
        if (monthlyRest) return { name: monthlyRest, source: 'monthly' };
        return { name: '', source: 'none' };
    }

    function getActiveCutoffTime() {
        const c1 = document.getElementById('cutoff-time');
        const c2 = document.getElementById('cutoff-time-mob');
        if (c1 && c1.offsetParent !== null) return c1.value;
        if (c2 && c2.offsetParent !== null) return c2.value;
        return (c1 ? c1.value : (c2 ? c2.value : '10:30')) || '10:30';
    }

    function handleFormState() {
        if (!orderDateInput || !mealTypeInput) return;
        const selectedDate = orderDateInput.value;
        const selectedMealType = mealTypeInput.value;
        const isSessionChanged = (selectedDate !== lastViewedDate || selectedMealType !== lastViewedMeal);
        const sessionOrders = getOrders().filter(o => o.date === selectedDate && o.mealType === selectedMealType);
        const anyOrder = sessionOrders.length > 0;
        const settings = getSettings();
        const sessionKey = `${selectedDate}_${selectedMealType}`;
        const cloudCutoff = memoryConfig[`cutoff_${sessionKey}`];
        const mealDefault = cloudCutoff || settings.mealCutoffs[selectedMealType] || settings.cutoffTime || '10:30';
        if (isSessionChanged && !anyOrder) cutoffInputs.forEach(input => { if (input) input.value = mealDefault; });
        const isTimeUp = isSessionLocked(selectedDate, selectedMealType);
        const currentOrderCutoff = getActiveCutoffTime();
        const recommendation = getRecommendedRestaurant(selectedDate, selectedMealType);
        const winner = recommendation.name;
        let displayWinner = '待定...';
        if (anyOrder || isTimeUp) displayWinner = winner || '待定...';
        restaurantInputs.forEach(input => {
            input.value = displayWinner; input.disabled = true;
            input.style.color = (displayWinner === '待定...') ? "var(--text-muted)" : "var(--text-main)";
        });
        const isAdmin = currentUser && currentUser.role === 'admin';
        const isTBD = (displayWinner === '待定...');
        
        // 使用者看到「待定...」時，隱藏表單
        if (orderFormContainer && !isAdmin) {
            orderFormContainer.classList.toggle('hidden', isTBD);
        }

        const userTbdWarning = document.getElementById('user-tbd-warning');
        const adminTbdWarning = document.getElementById('admin-tbd-warning');
        
        if (userTbdWarning) userTbdWarning.classList.toggle('hidden', !isTBD);
        if (adminTbdWarning) adminTbdWarning.classList.toggle('hidden', !isTBD);
        if (isTimeUp) {
            if (lockedWarning) {
                lockedWarning.classList.remove('hidden');
                lockedWarning.innerHTML = `⚠️ 【${selectedMealType}】訂單已鎖定。`;
            }
            if (submitOrderBtn) { submitOrderBtn.disabled = true; submitOrderBtn.innerHTML = '🔒 已鎖定'; }
        } else {
            if (lockedWarning) lockedWarning.classList.add('hidden');
            if (submitOrderBtn) { submitOrderBtn.disabled = false; submitOrderBtn.innerHTML = '🚀 送出訂單'; }
        }
        lastViewedDate = selectedDate; lastViewedMeal = selectedMealType;
    }

    function getCommonInputs() {
        return {
            date: document.getElementById('order-date')?.value || document.getElementById('order-date-mob')?.value || getTodayString(),
            meal: document.getElementById('meal-type')?.value || document.getElementById('meal-type-mob')?.value || '午餐',
            rest: document.getElementById('restaurant-name')?.value || document.getElementById('restaurant-name-mob')?.value || '',
            cutoff: document.getElementById('cutoff-time')?.value || document.getElementById('cutoff-time-mob')?.value || '10:30'
        };
    }

    submitOrderBtn.addEventListener('click', () => {
        const inputs = getCommonInputs();
        const name = personNameInput.value.trim();
        const item = itemNameInput.value.trim();
        if (isSessionLocked(inputs.date, inputs.meal)) { showToast("此餐期已鎖定！", "error"); return; }
        let finalPrice = parseFloat(itemPriceInput.value) || 0;
        if (!name || !item || !inputs.rest || inputs.rest === '待定...') { showToast("請完整填寫資訊！", "error"); return; }
        const newOrder = { id: Date.now().toString(), date: inputs.date, mealType: inputs.meal, name: name, userName: name, item: item, price: finalPrice, restaurant: inputs.rest, cutoffTime: inputs.cutoff, paid: false };
        saveOrders([...getOrders(), newOrder], "addOrder", newOrder);
        personNameInput.value = (currentUser && currentUser.role === 'user') ? currentUser.name : '';
        itemNameInput.value = ''; itemPriceInput.value = '';
        showToast(`訂購成功：${item}`);
        updateGrandTotal();
    });

    function updateGrandTotal() {
        const wt = getWeekData(currentViewDate);
        const gTotal = wt.weekOrders.reduce((acc, cur) => acc + cur.price, 0);
        const elGrand = document.getElementById('dash-grand-total');
        if (elGrand) elGrand.textContent = `$${gTotal}`;
        const todayStr = getTodayString();
        const todayOrders = getOrders().filter(o => o.date === todayStr);
        const todayTotal = todayOrders.reduce((acc, cur) => acc + cur.price, 0);
        const elCount = document.getElementById('dash-today-count');
        const elTodayTotal = document.getElementById('dash-today-total');
        if (elCount) elCount.textContent = todayOrders.length;
        if (elTodayTotal) elTodayTotal.textContent = todayTotal;
    }

    function getWeekData(dateObj) {
        const allOrders = getOrders();
        const refDate = new Date(dateObj);
        const currentDay = refDate.getDay();
        const dist = currentDay === 0 ? 6 : currentDay - 1;
        const monday = new Date(refDate); monday.setDate(refDate.getDate() - dist);
        const weekDates = [];
        const days = ['(一)', '(二)', '(三)', '(四)', '(五)', '(六)', '(日)'];
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday); d.setDate(monday.getDate() + i);
            weekDates.push({ dateString: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, dayLabel: days[i] });
        }
        const weekOrders = allOrders.filter(o => o.date >= weekDates[0].dateString && o.date <= weekDates[6].dateString);
        return { weekDates, weekOrders, allOrders, labelText: `${weekDates[0].dateString} ~ ${weekDates[6].dateString}` };
    }

    function renderOrders() {
        const { weekDates, weekOrders, allOrders, labelText } = getWeekData(currentViewDate);
        if (currentWeekLabel) currentWeekLabel.innerText = labelText;
        let fWeekOrders = weekOrders; let fAllOrders = allOrders;
        if (currentUser && currentUser.role === 'user') {
            fWeekOrders = weekOrders.filter(o => o.name === currentUser.name);
            fAllOrders = allOrders.filter(o => o.name === currentUser.name);
        }
        const container = document.getElementById('dynamic-table-container');
        if (!container) return; container.innerHTML = '';
        if (currentActiveTab === 'tab-details') renderDetailsTable(weekDates, fAllOrders, container);
        else if (currentActiveTab === 'tab-caller') renderCallerTable(weekDates, fAllOrders, container);
        else if (currentActiveTab === 'tab-person') renderPersonTable(fWeekOrders, container);
    }

    function renderDetailsTable(weekDates, allOrders, container) {
        const table = document.createElement('table'); table.className = 'excel-table';
        table.innerHTML = `<thead><tr><th>日期 / 餐廳</th><th>姓名</th><th>餐點</th><th>金額</th><th>付清</th><th>操作</th></tr></thead>`;
        const tbody = document.createElement('tbody');
        weekDates.forEach(({ dateString, dayLabel }) => {
            const dayOrders = allOrders.filter(o => o.date === dateString);
            if (dayOrders.length === 0) {
                tbody.innerHTML += `<tr><td>${dateString} ${dayLabel}</td><td colspan="5" style="text-align:center;color:var(--text-muted);">無紀錄</td></tr>`;
            } else {
                dayOrders.forEach((order, idx) => {
                    const isAdmin = currentUser && currentUser.role === 'admin';
                    const isLocked = isSessionLocked(order.date, order.mealType);
                    const tr = document.createElement('tr');
                    if (order.paid) tr.classList.add('row-paid');
                    tr.innerHTML = `
                        ${idx === 0 ? `<td rowspan="${dayOrders.length}">${order.date}<br>🏠 ${order.restaurant}</td>` : ''}
                        <td>${order.name}</td><td>${order.item}</td><td>$${order.price}</td>
                        <td style="text-align:center;"><input type="checkbox" ${order.paid ? 'checked' : ''} ${isAdmin ? '' : 'disabled'} onchange="window.togglePaid('${order.id}', this.checked)"></td>
                        <td>
                            ${isAdmin || !isLocked ? `<button class="edit-record-btn" onclick="window.triggerEdit('${order.id}')">✏️</button><button class="delete-record-btn" onclick="window.deleteOrder('${order.id}')">🗑️</button>` : '🔒'}
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        });
        table.appendChild(tbody); container.appendChild(table);
    }

    window.triggerEdit = function(id) {
        const order = getOrders().find(o => String(o.id) === String(id));
        if (!order) return;
        const isAdmin = currentUser && currentUser.role === 'admin';
        if (isAdmin) { window.openEditOrderModal(id); }
        else {
            personNameInput.value = order.name; itemNameInput.value = order.item; itemPriceInput.value = order.price;
            document.getElementById('order-date').value = order.date;
            excelModal.classList.add('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' });
            showToast("已填回表單，請修改後重新送出。");
            saveOrders(getOrders().filter(o => o.id !== id), "deleteOrder", { id: id });
        }
    };

    function renderCallerTable(weekDates, allOrders, container) {
        const table = document.createElement('table'); table.className = 'excel-table';
        table.innerHTML = `<thead><tr><th>日期 / 餐廳</th><th>明細匯總</th><th>小計</th></tr></thead>`;
        const tbody = document.createElement('tbody');
        weekDates.forEach(({ dateString }) => {
            const dayOrders = allOrders.filter(o => o.date === dateString);
            if (dayOrders.length === 0) return;
            const rest = dayOrders[0].restaurant;
            const items = {}; let total = 0;
            dayOrders.forEach(o => { items[o.item] = (items[o.item] || 0) + 1; total += o.price; });
            const itemStr = Object.entries(items).map(([k,v]) => `${k} x ${v}`).join('<br>');
            tbody.innerHTML += `<tr><td>${dateString}<br>🏠 ${rest}</td><td>${itemStr}</td><td>$${total}</td></tr>`;
        });
        table.appendChild(tbody); container.appendChild(table);
    }

    function renderPersonTable(weekOrders, container) {
        const table = document.createElement('table'); table.className = 'excel-table';
        table.innerHTML = `<thead><tr><th>姓名</th><th>次數</th><th>總額</th><th>狀態</th></tr></thead>`;
        const tbody = document.createElement('tbody');
        const map = {};
        weekOrders.forEach(o => {
            if (!map[o.name]) map[o.name] = { count: 0, total: 0, unpaid: 0 };
            map[o.name].count++; map[o.name].total += o.price; if (!o.paid) map[o.name].unpaid += o.price;
        });
        Object.entries(map).forEach(([name, d]) => {
            tbody.innerHTML += `<tr><td>${name}</td><td>${d.count}</td><td>$${d.total}</td><td>${d.unpaid === 0 ? '✅ 已清' : `❌ 欠$${d.unpaid}`}</td></tr>`;
        });
        table.appendChild(tbody); container.appendChild(table);
    }

    window.togglePaid = function(id, paid) {
        const orders = getOrders(); const idx = orders.findIndex(o => o.id === id);
        if (idx !== -1) { orders[idx].paid = paid; saveOrders(orders, "updateOrder", orders[idx]); updateGrandTotal(); renderOrders(); }
    };

    window.deleteOrder = function(id) { if (confirm('確定刪除？')) { saveOrders(getOrders().filter(o => o.id !== id), "deleteOrder", { id: id }); renderOrders(); updateGrandTotal(); } };

    const editOrderModal = document.getElementById('edit-order-modal');
    window.openEditOrderModal = function(id) {
        const order = getOrders().find(o => o.id === id); if (!order) return;
        document.getElementById('edit-order-id').value = order.id;
        document.getElementById('edit-order-user').value = order.name;
        document.getElementById('edit-order-item').value = order.item;
        document.getElementById('edit-order-price').value = order.price;
        document.getElementById('edit-order-note').value = order.note || '';
        document.getElementById('edit-order-paid').checked = !!order.paid;
        editOrderModal.classList.remove('hidden');
    };
    window.closeEditOrderModal = () => editOrderModal.classList.add('hidden');
    window.saveEditedOrder = () => {
        const id = document.getElementById('edit-order-id').value;
        const orders = getOrders(); const idx = orders.findIndex(o => o.id === id);
        if (idx !== -1) {
            orders[idx].item = document.getElementById('edit-order-item').value;
            orders[idx].price = parseFloat(document.getElementById('edit-order-price').value) || 0;
            orders[idx].paid = document.getElementById('edit-order-paid').checked;
            saveOrders(orders, "updateOrder", orders[idx]); closeEditOrderModal(); renderOrders(); updateGrandTotal();
        }
    };

    prevWeekBtn.onclick = () => { currentViewDate.setDate(currentViewDate.getDate() - 7); renderOrders(); };
    nextWeekBtn.onclick = () => { currentViewDate.setDate(currentViewDate.getDate() + 7); renderOrders(); };
    currentWeekBtn.onclick = () => { currentViewDate = new Date(); renderOrders(); };
    
    // 復原匯出 CSV 與清理歷史邏輯
    if (exportCsvBtn) {
        exportCsvBtn.onclick = () => {
            const { weekOrders } = getWeekData(currentViewDate);
            if (weekOrders.length === 0) return alert('本週無資料可匯出');
            
            let csv = '\uFEFF';
            
            if (currentActiveTab === 'tab-details') {
                csv += "日期,餐期,餐廳,姓名,餐點名稱,金額,付款狀態\r\n";
                weekOrders.forEach(o => {
                    const m = (o.mealType || '午餐').replace(/"/g, '""');
                    const r = (o.restaurant || '未指定').replace(/"/g, '""');
                    const n = (o.name || '').replace(/"/g, '""');
                    const i = (o.item || '').replace(/"/g, '""');
                    const p = o.paid ? '已付清' : '未付';
                    csv += `"${o.date}","${m}","${r}","${n}","${i}","${o.price}","${p}"\r\n`;
                });
            } else if (currentActiveTab === 'tab-caller') {
                csv += "日期,餐期,餐廳,餐點明細匯總,該餐期總計金額\r\n";
                const sessionMap = {};
                weekOrders.forEach(o => {
                    const sKey = `${o.date}_${o.mealType || '午餐'}`;
                    if (!sessionMap[sKey]) sessionMap[sKey] = [];
                    sessionMap[sKey].push(o);
                });
                Object.values(sessionMap).forEach(sessionOrders => {
                    const date = sessionOrders[0].date;
                    const mType = (sessionOrders[0].mealType || '午餐').replace(/"/g, '""');
                    const restName = (sessionOrders.find(o => o.restaurant)?.restaurant || '未指定').replace(/"/g, '""');
                    let sessionTotal = 0;
                    const itemMap = {};
                    sessionOrders.forEach(o => {
                        sessionTotal += o.price;
                        const item = o.item || '未填寫';
                        if (!itemMap[item]) itemMap[item] = 0;
                        itemMap[item]++;
                    });
                    const summaryStr = Object.entries(itemMap).map(([k, v]) => `${k} x ${v}`).join(' / ');
                    csv += `"${date}","${mType}","${restName}","${summaryStr}","${sessionTotal}"\r\n`;
                });
            } else if (currentActiveTab === 'tab-person') {
                csv += "姓名,點餐次數,本週總花費,已繳交,尚欠款,結清狀態\r\n";
                const personMap = {};
                weekOrders.forEach(o => {
                    if (!personMap[o.name]) personMap[o.name] = { count: 0, total: 0, paidTotal: 0, orderIds: [] };
                    personMap[o.name].count++;
                    personMap[o.name].total += o.price;
                    if (o.paid) personMap[o.name].paidTotal += o.price;
                    personMap[o.name].orderIds.push(o.id);
                });
                Object.entries(personMap).forEach(([name, data]) => {
                    const remains = data.total - data.paidTotal;
                    const status = remains === 0 ? '已結清' : '未結清';
                    csv += `"${name.replace(/"/g, '""')}","${data.count}筆","${data.total}","${data.paidTotal}","${remains}","${status}"\r\n`;
                });
            }

            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `訂餐報表_${getTodayString()}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showToast('✅ 報表匯出成功！', 'success');
        };
    }
    
    if (clearHistoryBtn) {
        clearHistoryBtn.onclick = () => {
            const action = prompt('⚠️ 系統大掃除 ⚠️\n\n輸入「1」：清除 30 天以前的舊紀錄\n輸入「ALL」：徹底刪除整體系統資料\n\n請輸入代碼：');
            if (action === '1') {
                const limitDate = new Date(); limitDate.setDate(limitDate.getDate() - 30);
                const limitStr = limitDate.toISOString().split('T')[0];
                const orders = getOrders();
                const keepOrders = orders.filter(o => o.date >= limitStr);
                const deletedCount = orders.length - keepOrders.length;
                if (deletedCount > 0) {
                    saveOrders(keepOrders); showToast(`永久清除了 ${deletedCount} 筆超過 30 天的舊紀錄。`);
                    renderOrders(); updateGrandTotal();
                } else {
                    showToast('目前沒有超過 30 天的舊帳。', 'info');
                }
            } else if (action === 'ALL') {
                if (confirm('🚨 警告：這將會永久清空「所有的訂單」與「個人的歷史設定」！確定嗎？')) {
                    saveOrders([]); localStorage.removeItem(SETTINGS_KEY); location.reload();
                }
            }
        };
    }

    function handleImageFile(file, callback) {
        if (!file || !file.type.startsWith('image/')) return callback('');
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width; let height = img.height;
                const MAX_WIDTH = 1200; const MAX_HEIGHT = 1600;
                if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
                if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                callback(canvas.toDataURL('image/webp', 0.6));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    function renderSettingsTab() {
        const container = document.getElementById('settings-dynamic-content'); if (!container) return;
        if (activeSettingsTab === 'tab-users') {
            container.innerHTML = `
                <div style="background:var(--card-bg); padding:1rem; border-radius:0.5rem; margin-bottom:1rem; border:1px solid var(--border);">
                    <h4 style="margin-top:0;">新增人員</h4>
                    <div style="display:flex; gap:0.5rem;">
                        <input id="new-u-name" class="restaurant-input" placeholder="姓名" style="flex:2;">
                        <select id="new-u-role" class="restaurant-input" style="flex:1;">
                            <option value="user">一般點餐者</option><option value="admin">管理員</option>
                        </select>
                        <button onclick="window.addU()" class="primary-btn" style="width:auto; margin:0;">新增</button>
                    </div>
                </div>
                <div style="display:grid; gap:0.5rem;">
                    ${memoryUsers.map((u, i) => `
                        <div style="display:flex; justify-content:space-between; align-items:center; background:var(--input-bg); padding:0.75rem; border-radius:0.5rem; border:1px solid var(--border);">
                            <div><strong>${u.name}</strong> <span style="font-size:0.8rem; color:var(--text-muted);">(${u.role})</span></div>
                            <button onclick="window.delU(${i})" style="color:var(--danger); border:none; background:none; cursor:pointer; font-weight:bold;">刪除</button>
                        </div>
                    `).join('')}
                </div>
            `;
        } else if (activeSettingsTab === 'tab-restaurants') {
            container.innerHTML = `
                <div style="background:var(--card-bg); padding:1rem; border-radius:0.5rem; margin-bottom:1rem; border:1px solid var(--border);">
                    <h4 style="margin-top:0;">新增餐廳</h4>
                    <div style="display:flex; flex-direction:column; gap:0.5rem;">
                        <input id="new-r-name" class="restaurant-input" placeholder="餐廳名稱 (必填)">
                        <input id="new-r-phone" class="restaurant-input" placeholder="電話 (選填)">
                        <input id="new-r-url" class="restaurant-input" placeholder="菜單網址 (選填)">
                        <div style="display:flex; align-items:center; gap:0.5rem;">
                            <label style="font-size:0.85rem; color:var(--text-muted); flex-shrink:0;">照片：</label>
                            <input type="file" id="new-r-file" accept="image/*" class="restaurant-input" style="padding:0.4rem;">
                        </div>
                        <button onclick="window.addR()" id="add-r-btn" class="primary-btn" style="margin-top:0.5rem;">儲存並新增</button>
                    </div>
                </div>
                <div style="display:grid; gap:0.5rem;">
                    ${memoryRestaurants.map((r, i) => `
                        <div style="display:flex; flex-direction:column; background:var(--input-bg); padding:0.75rem; border-radius:0.5rem; border:1px solid var(--border);">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <strong>${r.name}</strong>
                                <button onclick="window.delR(${i})" style="color:var(--danger); border:none; background:none; cursor:pointer; font-weight:bold;">刪除</button>
                            </div>
                            <div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.25rem;">
                                ${r.phone ? `☎️ ${r.phone}` : ''}
                                ${r.menuUrl ? ` 🔗有網址` : ''}
                                ${r.menuImage && r.menuImage.length > 100 ? ` 📸有照片` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            container.innerHTML = `
                <div style="padding:1rem;">
                    <p style="color:var(--text-muted); margin-bottom:1rem;">系統基本參數配置。</p>
                    <div class="form-group">
                        <label>🕒 預設鎖單時間</label>
                        <input type="time" id="sys-default-cutoff" class="restaurant-input" value="${memoryConfig.defaultCutoffTime || '10:30'}">
                    </div>
                    <button onclick="window.saveSysConfig()" class="primary-btn" style="margin-top:1rem;">儲存設定</button>
                </div>
            `;
        }
    }

    window.addU = () => { const n = document.getElementById('new-u-name').value; const r = document.getElementById('new-u-role').value; if(!n)return; memoryUsers.push({id:Date.now(), name:n, password:"", role:r}); saveCloudData("saveUsers", memoryUsers).then(()=>renderSettingsTab()); };
    window.delU = (i) => { if(confirm('確定刪除此人?')) { memoryUsers.splice(i,1); saveCloudData("saveUsers", memoryUsers).then(()=>renderSettingsTab()); } };
    window.addR = () => {
        const btn = document.getElementById('add-r-btn');
        const n = document.getElementById('new-r-name').value;
        const p = document.getElementById('new-r-phone').value;
        const u = document.getElementById('new-r-url').value;
        const f = document.getElementById('new-r-file').files[0];
        if(!n) return alert('需填寫餐廳名稱');
        
        btn.disabled = true; btn.innerText = "處理圖片及上傳中...";
        handleImageFile(f, (base64Img) => {
            memoryRestaurants.push({ id:Date.now(), name:n, phone:p, menuUrl:u, menuImage:base64Img });
            saveCloudData("saveRestaurants", memoryRestaurants).then(()=> {
                renderSettingsTab();
                syncAdminDash();
                showToast(`餐廳 ${n} 已新增`);
            });
        });
    };
    window.delR = (i) => { if (confirm('確定刪除此餐廳?')) { memoryRestaurants.splice(i,1); saveCloudData("saveRestaurants", memoryRestaurants).then(()=>{ renderSettingsTab(); syncAdminDash(); }); } };
    window.saveSysConfig = () => {
        const c = document.getElementById('sys-default-cutoff').value;
        if(c) memoryConfig.defaultCutoffTime = c;
        saveCloudData("saveConfig", Object.entries(memoryConfig).map(([k,v])=>({key:k, value:v}))).then(()=> showToast('設定已儲存', 'success'));
    };

    document.addEventListener('click', (e) => {
        const tab = e.target.closest('.tab-btn, .settings-tab-btn'); if (!tab) return;
        const name = tab.dataset.tab;
        if (tab.classList.contains('settings-tab-btn')) {
            activeSettingsTab = name;
            document.querySelectorAll('.settings-tab-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.tab === name);
            });
            renderSettingsTab();
        } else {
            highlightTab(name);
            renderOrders();
        }
    });

    function toggleRoleUI() {
        if (!currentUser) return; const isAdmin = currentUser.role === 'admin';
        document.body.classList.toggle('admin-mode', isAdmin);
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin ? '' : 'none');
        document.getElementById('admin-dashboard').style.display = isAdmin ? '' : 'none';
        document.getElementById('order-form-container').style.display = isAdmin ? 'none' : '';
        if (isAdmin) { renderAdminSchedule(); syncAdminDash(); }
        else { if(personNameInput) { personNameInput.value = currentUser.name; personNameInput.disabled = true; } }
        renderOrders();
    }

    function syncAdminDash() {
        document.getElementById('admin-order-date').value = document.getElementById('order-date').value;
        const sel = document.getElementById('admin-restaurant-name');
        if (sel) {
            const currentVal = sel.value;
            sel.innerHTML = '<option value="">請選擇餐廳...</option>' + memoryRestaurants.map(r => `<option value="${r.name}">${r.name}</option>`).join('');
            sel.value = currentVal;
            
            // 綁定管理員切換今日餐廳同步功能 (只綁定一次)
            if (!sel.dataset.bound) {
                sel.dataset.bound = true;
                sel.addEventListener('change', (e) => {
                    const rName = e.target.value;
                    const inputs = getCommonInputs();
                    memoryConfig[`restaurant_${inputs.date}_${inputs.meal}`] = rName;
                    
                    const newConfig = Object.entries(memoryConfig).map(([k,v])=>{
                        let val = v;
                        if (k === 'voteCutoffTime' || k.startsWith('cutoff_') || k.startsWith('monthly_') || k.startsWith('restaurant_')) {
                            val = "'" + String(v).replace(/^'/, '');
                        }
                        return {key:k, value:val};
                    });
                    
                    saveCloudData("saveConfig", newConfig).then(() => {
                        syncAndRefresh(document.querySelectorAll('#restaurant-name, #restaurant-name-mob'), rName, true);
                        showToast(`已將今日餐廳設定為：${rName || '待定...'}`);
                    });
                });
            }
        }
    }
    window.saveMon = () => {
        document.querySelectorAll('.mon-sel').forEach(s => memoryConfig[`monthly_午餐_${s.dataset.day}`] = s.value);
        saveCloudData("saveConfig", Object.entries(memoryConfig).map(([k,v])=>({key:k, value:"'"+v})));
        showToast("已儲存！");
    };

    // ==========================================
    // 系統排程器 (欠款通知與廣播)
    // ==========================================
    function showUserUnpaidPopup(detailsHtml) {
        if (document.getElementById('unpaid-popup')) return; // 避免重複
        const d = document.createElement('div');
        d.id = 'unpaid-popup';
        d.className = 'modal-overlay';
        d.style.zIndex = '3000';
        d.innerHTML = `
            <div class="modal-content" style="max-width: 400px; text-align: center;">
                <div style="font-size: 3rem; margin-bottom: 1rem;">🚨</div>
                <h3 style="color: var(--danger); margin-bottom: 1rem;">未結清款項提醒</h3>
                <p style="color: var(--text-main); font-size: 0.95rem; margin-bottom: 1.5rem;">您本週尚有未結清的款項，請盡快將錢交給管理員！</p>
                <div style="background: var(--input-bg); border-radius: 0.5rem; padding: 1rem; text-align: left; margin-bottom: 1.5rem; font-size: 0.85rem; color: var(--text-muted); line-height: 1.6;">
                    ${detailsHtml}
                </div>
                <button onclick="document.getElementById('unpaid-popup').remove()" class="primary-btn" style="width: 100%;">我知道了，這就去繳</button>
            </div>
        `;
        document.body.appendChild(d);
    }

    let lastNotifiedTime = "0";
    function startNotifyScheduler() {
        if (!currentUser || currentUser.role === 'admin') return;
        
        // 1. 預設檢查一次
        fetch(API_URL + "?action=checkNotify")
            .then(res => res.json())
            .then(data => { if (data.status === 'success') lastNotifiedTime = data.lastManualNotify; })
            .catch(() => {});

        // 2. 設定週期性檢查 (每 1 分鐘)
        setInterval(() => {
            fetch(API_URL + "?action=checkNotify")
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'success' && data.lastManualNotify !== "0" && data.lastManualNotify !== lastNotifiedTime) {
                        lastNotifiedTime = data.lastManualNotify;
                        fetch(API_URL, {
                            method: "POST",
                            body: JSON.stringify({ action: "getWeeklyUnpaidSummary", data: {} })
                        }).then(r => r.json()).then(res => {
                            if (res.status === 'success' && res.summary) {
                                const myData = res.summary.find(s => s.name === currentUser.name);
                                if (myData && myData.amount > 0) {
                                    const detailsHtml = myData.details.map(d => `• ${d}`).join('<br>');
                                    showUserUnpaidPopup(`欠款總計：<strong>$${myData.amount}</strong><br>` + detailsHtml);
                                }
                            }
                        });
                    }
                }).catch(err => console.error("Notify check err:", err));
        }, 60000);
    }
    // ==========================================

    function checkAuth() {
        const u = localStorage.getItem('lunch_user');
        if (u) { currentUser = JSON.parse(u); loginOverlay.style.display = 'none'; toggleRoleUI(); startNotifyScheduler(); }
        else loginOverlay.style.display = 'flex';
    }

    authSubmitBtn.onclick = () => {
        const n = authNameInput.value.trim(); const p = authPassInput.value.trim();
        if (n==='admin' && p==='1234') { loginSuccess(n, 'admin'); }
        else { const u = memoryUsers.find(u=>u.name===n && u.password===p); if(u) loginSuccess(n, 'user'); else showToast("錯誤","error"); }
    };
    function loginSuccess(n, r) { currentUser = {name:n, role:r}; localStorage.setItem('lunch_user', JSON.stringify(currentUser)); location.reload(); }
    const doLogout = () => { if (confirm("確定要登出嗎？")) { localStorage.removeItem('lunch_user'); location.reload(); } };
    safeListen(document.getElementById('logout-btn'), 'click', doLogout);
    safeListen(document.getElementById('logout-btn-mob'), 'click', doLogout);

    try { checkAuth(); } catch(e){}
    const cached = localStorage.getItem(CLOUD_CACHE_KEY);
    if (cached) {
        const c = JSON.parse(cached); memoryOrders = c.orders || []; memoryUsers = c.users || []; memoryRestaurants = c.restaurants || [];
        if (c.config) c.config.forEach(i => memoryConfig[i.key] = i.value);
        updateDatalists(); handleFormState(); updateGrandTotal();
    }
    fetchFromCloud(); setInterval(fetchFromCloud, 15000);
});
