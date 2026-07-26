/* =========================================================
   SUPABASE DATABASE CONFIGURATION & REAL DB INTEGRATION
   ========================================================= */
const SUPABASE_URL = 'https://zbjsyzqqkdmflagetrgi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_f11KZfo4njQ3DqJHkFl2yA_yDAAv2I6';

let supabaseClient = null;
if (SUPABASE_URL.startsWith('http')) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/* =========================================================
   TELEGRAM WEBAPP & APP STATE INITIALIZATION
   ========================================================= */
const tg = window.Telegram?.WebApp;
let telegramId = '123456789';
let username = 'MegaUser';

if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
    telegramId = String(tg.initDataUnsafe.user.id);
    username = tg.initDataUnsafe.user.username || tg.initDataUnsafe.user.first_name || 'MegaUser';
    tg.expand();
}

// App State
let currentUserRecord = null;
let userBalance = 0.00;
let referralCount = 0;
let referralRewardsEarned = 0.00;
let hasWithdrawnBefore = false;

// Dynamic Data Containers (Loaded from Supabase)
let tasksData = {
    daily: [],
    social: [],
    ads: []
};

let withdrawHistory = [];
let userTaskHistory = [];
let notificationsList = [];

// DOM Element Bindings
const homeBalanceEl = document.getElementById('home-balance');
const headerBalanceEl = document.getElementById('header-balance');
const walletBalanceEl = document.getElementById('wallet-balance');
const refCountEl = document.getElementById('ref-count');
const refRewardsEl = document.getElementById('ref-rewards');
const refLinkInput = document.getElementById('ref-link-input');
const usernameEl = document.getElementById('username');

if (usernameEl) usernameEl.textContent = username;

function updateUI() {
    const formatted = userBalance.toLocaleString('en-US', { minimumFractionDigits: 2 });
    if (homeBalanceEl) homeBalanceEl.textContent = formatted;
    if (headerBalanceEl) headerBalanceEl.textContent = formatted;
    if (walletBalanceEl) walletBalanceEl.textContent = formatted + " MC";
    if (refCountEl) refCountEl.textContent = referralCount;
    if (refRewardsEl) refRewardsEl.textContent = referralRewardsEarned.toLocaleString('en-US', { minimumFractionDigits: 2 });
    if (refLinkInput) refLinkInput.value = `https://t.me/megacoineasy_bot?start=${telegramId}`;
}

/* =========================================================
   DATABASE SYNC FUNCTIONS (SUPABASE)
   ========================================================= */
async function initializeUserInSupabase() {
    if (!supabaseClient) {
        updateUI();
        return;
    }

    try {
        let { data, error } = await supabaseClient
            .from('users')
            .select('*')
            .eq('telegram_id', telegramId)
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            const newUser = {
                telegram_id: telegramId,
                username: username,
                balance: 65000.00,
                referrals: 0,
                created_at: new Date().toISOString()
            };

            const { data: insertedUser, error: insertError } = await supabaseClient
                .from('users')
                .insert([newUser])
                .select()
                .single();

            if (insertError) throw insertError;
            currentUserRecord = insertedUser;
        } else {
            currentUserRecord = data;
        }

        userBalance = Number(currentUserRecord.balance) || 0;
        referralCount = Number(currentUserRecord.referrals) || 0;
        referralRewardsEarned = referralCount * 500;

        updateUI();
        await fetchTasksFromSupabase();
        await fetchWithdrawalsFromSupabase();
        await fetchTaskHistoryFromSupabase();
        await fetchReferralsFromSupabase();
        await fetchNotificationsFromSupabase();

    } catch (err) {
        console.error('Error initializing user with Supabase:', err.message);
        updateUI();
    }
}

async function updateSupabaseBalance(newBalance) {
    userBalance = newBalance;
    updateUI();

    if (!supabaseClient || !currentUserRecord) return;

    try {
        const { error } = await supabaseClient
            .from('users')
            .update({ balance: userBalance })
            .eq('telegram_id', telegramId);

        if (error) throw error;
    } catch (err) {
        console.error('Error updating balance in Supabase:', err.message);
    }
}

async function fetchTasksFromSupabase() {
    if (!supabaseClient) return;

    try {
        const { data, error } = await supabaseClient
            .from('tasks')
            .select('*');

        if (error) throw error;

        if (data) {
            tasksData = { daily: [], social: [], ads: [] };
            data.forEach(t => {
                const formattedTask = {
                    id: t.id,
                    title: t.title,
                    description: t.description,
                    reward: `+${Number(t.reward).toLocaleString()} MC`,
                    reward_val: Number(t.reward),
                    category: t.category ? t.category.toLowerCase() : 'daily',
                    status: 'Pending',
                    completed: false
                };

                if (tasksData[formattedTask.category]) {
                    tasksData[formattedTask.category].push(formattedTask);
                } else {
                    tasksData.daily.push(formattedTask);
                }
            });
            renderTasks();
        }
    } catch (err) {
        console.error('Error fetching tasks from Supabase:', err.message);
    }
}

async function fetchTaskHistoryFromSupabase() {
    if (!supabaseClient || !currentUserRecord) return;

    try {
        const { data, error } = await supabaseClient
            .from('task_history')
            .select('*')
            .eq('user_id', currentUserRecord.id);

        if (error) throw error;

        if (data) {
            userTaskHistory = data;
            data.forEach(dbTask => {
                for (const cat in tasksData) {
                    const found = tasksData[cat].find(t => t.id === dbTask.task_id || t.title.toLowerCase() === dbTask.title?.toLowerCase());
                    if (found) {
                        found.status = dbTask.status;
                        found.completed = true;
                        if (dbTask.status === 'Approved' && !found.rewarded) {
                            found.rewarded = true;
                        }
                    }
                }
            });
            renderTasks();
            renderHistoryLists();
        }
    } catch (err) {
        console.error('Error fetching task history:', err.message);
    }
}

async function fetchWithdrawalsFromSupabase() {
    if (!supabaseClient || !currentUserRecord) return;

    try {
        const { data, error } = await supabaseClient
            .from('withdrawals')
            .select('*')
            .eq('user_id', currentUserRecord.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (data) {
            withdrawHistory = data.map(item => ({
                date: item.created_at ? item.created_at.split('T')[0] : new Date().toISOString().split('T')[0],
                method: item.method,
                amount: '$' + (Number(item.amount) / 10000).toFixed(2),
                status: item.status
            }));
            hasWithdrawnBefore = data.length > 0;
            renderWithdrawHistory();
        }
    } catch (err) {
        console.error('Error fetching withdrawals:', err.message);
    }
}

async function fetchReferralsFromSupabase() {
    if (!supabaseClient || !currentUserRecord) return;

    try {
        const { data, error } = await supabaseClient
            .from('referrals')
            .select('*')
            .eq('referrer_id', currentUserRecord.id);

        if (error) throw error;

        if (data) {
            referralCount = data.length;
            referralRewardsEarned = data.reduce((acc, curr) => acc + (Number(curr.reward) || 500), 0);
            updateUI();
        }
    } catch (err) {
        console.error('Error fetching referrals:', err.message);
    }
}

async function fetchNotificationsFromSupabase() {
    if (!supabaseClient) return;

    try {
        const { data, error } = await supabaseClient
            .from('notifications')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) throw error;

        if (data) {
            notificationsList = data;
        }
    } catch (err) {
        console.error('Error fetching notifications:', err.message);
    }
}

async function recordTaskCompletionToSupabase(task) {
    if (!supabaseClient || !currentUserRecord) return;

    try {
        const payload = {
            user_id: currentUserRecord.id,
            task_id: task.id,
            title: task.title,
            description: task.description,
            reward: task.reward_val,
            status: 'Pending',
            created_at: new Date().toISOString()
        };

        const { error } = await supabaseClient
            .from('task_history')
            .insert([payload]);

        if (error) throw error;
    } catch (err) {
        console.error('Error storing task history:', err.message);
    }
}

async function recordWithdrawalToSupabase(method, address, amount) {
    if (!supabaseClient || !currentUserRecord) return;

    try {
        const payload = {
            user_id: currentUserRecord.id,
            method: method,
            address: address,
            amount: amount,
            status: 'Pending',
            created_at: new Date().toISOString()
        };

        const { error } = await supabaseClient
            .from('withdrawals')
            .insert([payload]);

        if (error) throw error;
    } catch (err) {
        console.error('Error storing withdrawal request:', err.message);
    }
}

/* =========================================================
   UI NAVIGATION & EVENT HANDLERS
   ========================================================= */
const navItems = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.page');

navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const target = item.getAttribute('data-target');
        if (!target) return;
        
        navItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');

        pages.forEach(page => page.classList.remove('active'));
        const targetPage = document.getElementById(`page-${target}`);
        if (targetPage) targetPage.classList.add('active');
    });
});

const walletShortcut = document.getElementById('nav-wallet-shortcut');
if (walletShortcut) {
    walletShortcut.addEventListener('click', () => {
        const walletNav = document.querySelector('[data-target="wallet"]');
        if (walletNav) walletNav.click();
    });
}

const copyRefBtn = document.getElementById('copy-ref-btn');
if (copyRefBtn) {
    copyRefBtn.addEventListener('click', () => {
        if (refLinkInput) {
            refLinkInput.select();
            navigator.clipboard.writeText(refLinkInput.value);
            alert('Referral link copied to clipboard!');
        }
    });
}

const streakBtn = document.getElementById('streak-btn');
if (streakBtn) {
    streakBtn.addEventListener('click', async () => {
        const newBal = userBalance + 500;
        await updateSupabaseBalance(newBal);
        alert('Daily streak reward claimed successfully (+500 MC)!');
    });
}

// Tasks Rendering & Management
let currentTaskFilter = 'daily';
const tasksContainer = document.getElementById('tasks-container');

function renderTasks() {
    if (!tasksContainer) return;
    tasksContainer.innerHTML = '';
    const list = tasksData[currentTaskFilter] || [];

    if (list.length === 0) {
        tasksContainer.innerHTML = '<p style="color:var(--text-muted);text-align:center;font-size:12px;">No tasks available.</p>';
        return;
    }

    list.forEach(task => {
        const item = document.createElement('div');
        item.className = 'task-item';
        
        let statusBadgeClass = 'status-pending';
        if (task.status === 'Approved') statusBadgeClass = 'status-approved';
        if (task.status === 'Rejected') statusBadgeClass = 'status-rejected';

        item.innerHTML = `
            <div class="task-info">
                <h4>${task.title}</h4>
                <p>${task.description}</p>
                <span class="task-reward">${task.reward}</span>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
                <span class="task-status-badge ${statusBadgeClass}">${task.status}</span>
                ${task.completed ? '<span style="font-size:11px; color:var(--success-color);">Done</span>' : `<button class="gold-btn" style="padding:6px 12px; font-size:11px;" onclick="completeTask('${currentTaskFilter}', '${task.id}')">Complete</button>`}
            </div>
        `;
        tasksContainer.appendChild(item);
    });
}

document.querySelectorAll('[data-task-filter]').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('[data-task-filter]').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentTaskFilter = e.target.getAttribute('data-task-filter');
        renderTasks();
    });
});

window.completeTask = async function(category, id) {
    const task = tasksData[category].find(t => t.id === id);
    if (task && !task.completed) {
        task.completed = true;
        task.status = 'Pending';
        renderTasks();
        renderHistoryLists();
        
        await recordTaskCompletionToSupabase(task);
        alert('Task submitted for review!');
    }
};

// Task History & History Page Render
function renderHistoryLists() {
    ['history-container', 'rank-history-container'].forEach(containerId => {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const activeFilterBtn = container.parentElement.querySelector('.filter-btn.active');
        const filterStatus = activeFilterBtn ? activeFilterBtn.getAttribute('data-history-filter') || activeFilterBtn.getAttribute('data-rank-filter') || 'pending' : 'pending';

        container.innerHTML = '';
        
        let matchedTasks = [];
        Object.values(tasksData).forEach(catList => {
            catList.forEach(t => {
                if (t.status.toLowerCase() === filterStatus) {
                    matchedTasks.push(t);
                }
            });
        });

        if (matchedTasks.length === 0) {
            container.innerHTML = `<p style="color:var(--text-muted);text-align:center;font-size:12px;">No ${filterStatus} tasks found.</p>`;
            return;
        }

        matchedTasks.forEach(task => {
            const item = document.createElement('div');
            item.className = 'task-item';
            item.innerHTML = `
                <div class="task-info">
                    <h4>${task.title}</h4>
                    <p>${task.description}</p>
                    <span class="task-reward">${task.reward}</span>
                </div>
                <span class="task-status-badge status-${task.status.toLowerCase()}">${task.status}</span>
            `;
            container.appendChild(item);
        });
    });
}

document.querySelectorAll('[data-history-filter], [data-rank-filter]').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const parent = e.target.parentElement;
        parent.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        renderHistoryLists();
    });
});

// Withdraw Configuration & Processing
const paymentMethodSelect = document.getElementById('payment-method-select');
const dynamicWithdrawFields = document.getElementById('dynamic-withdraw-fields');

function renderWithdrawFields() {
    if (!paymentMethodSelect || !dynamicWithdrawFields) return;
    const method = paymentMethodSelect.value;
    let html = '';

    if (method === 'usdt-bep20' || method === 'usdt-trc20') {
        html = `
            <input type="text" id="w-address" placeholder="Wallet Address">
            <input type="number" id="w-amount" placeholder="Withdraw Amount (MegaCoin)">
            <button class="gold-btn" id="submit-withdraw-btn">Submit Withdrawal</button>
        `;
    } else if (method === 'cbe') {
        html = `
            <input type="text" id="w-address" placeholder="Account Number">
            <input type="number" id="w-amount" placeholder="Withdraw Amount (MegaCoin)">
            <button class="gold-btn" id="submit-withdraw-btn">Submit Withdrawal</button>
        `;
    } else if (method === 'telebirr') {
        html = `
            <input type="text" id="w-address" placeholder="Phone Number">
            <input type="number" id="w-amount" placeholder="Withdraw Amount (MegaCoin)">
            <button class="gold-btn" id="submit-withdraw-btn">Submit Withdrawal</button>
        `;
    }

    dynamicWithdrawFields.innerHTML = html;
    
    const submitBtn = document.getElementById('submit-withdraw-btn');
    if (submitBtn) {
        submitBtn.addEventListener('click', processWithdrawal);
    }
}

if (paymentMethodSelect) {
    paymentMethodSelect.addEventListener('change', renderWithdrawFields);
}

const openWithdrawBtn = document.getElementById('open-withdraw-form');
const withdrawFormContainer = document.getElementById('withdraw-form-container');
const firstWithdrawModal = document.getElementById('first-withdraw-modal');

if (openWithdrawBtn) {
    openWithdrawBtn.addEventListener('click', () => {
        if (!hasWithdrawnBefore) {
            if (firstWithdrawModal) firstWithdrawModal.classList.remove('hidden');
            return;
        }
        if (withdrawFormContainer) withdrawFormContainer.classList.toggle('hidden');
    });
}

const acceptRulesBtn = document.getElementById('accept-rules-btn');
if (acceptRulesBtn) {
    acceptRulesBtn.addEventListener('click', () => {
        if (firstWithdrawModal) firstWithdrawModal.classList.add('hidden');
        hasWithdrawnBefore = true;
        if (withdrawFormContainer) withdrawFormContainer.classList.remove('hidden');
    });
}

async function processWithdrawal() {
    const addrInput = document.getElementById('w-address');
    const amtInput = document.getElementById('w-amount');

    if (!addrInput || !amtInput) return;
    const address = addrInput.value;
    const amount = parseFloat(amtInput.value);

    if (!address || !amount) {
        alert('Please fill in all required fields.');
        return;
    }

    if (amount < 50000) {
        alert('Minimum withdrawal amount is $5 (50,000 MegaCoin).');
        return;
    }

    if (amount > userBalance) {
        alert('Insufficient balance.');
        return;
    }

    const methodName = paymentMethodSelect.options[paymentMethodSelect.selectedIndex].text;

    const newBalance = userBalance - amount;
    await updateSupabaseBalance(newBalance);
    await recordWithdrawalToSupabase(methodName, address, amount);

    withdrawHistory.unshift({
        date: new Date().toISOString().split('T')[0],
        method: methodName,
        amount: '$' + (amount / 10000).toFixed(2),
        status: 'Pending'
    });
    hasWithdrawnBefore = true;
    renderWithdrawHistory();

    alert('Withdrawal request submitted successfully!');
    if (withdrawFormContainer) withdrawFormContainer.classList.add('hidden');
    addrInput.value = '';
    amtInput.value = '';
}

function renderWithdrawHistory() {
    const tbody = document.getElementById('withdraw-history-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    withdrawHistory.forEach(item => {
        const tr = document.createElement('tr');
        let statusBadgeClass = 'status-pending';
        if (item.status === 'Approved') statusBadgeClass = 'status-approved';
        if (item.status === 'Rejected') statusBadgeClass = 'status-rejected';

        tr.innerHTML = `
            <td>${item.date}</td>
            <td>${item.method}</td>
            <td>${item.amount}</td>
            <td><span class="task-status-badge ${statusBadgeClass}">${item.status}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

// App Initialization Execution
(async function initApp() {
    await initializeUserInSupabase();
    renderTasks();
    renderHistoryLists();
    renderWithdrawFields();
    renderWithdrawHistory();
})();
