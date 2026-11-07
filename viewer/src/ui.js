let errorTimer = null;

/**
 * エラー・情報メッセージを一定時間表示する
 * @param {string} message
 * @param {number} duration ミリ秒（デフォルト 3000）
 */
export function showMessage(message, duration = 3000) {
  const el = document.getElementById('error-msg');
  el.textContent = message;
  el.classList.remove('hidden');
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = setTimeout(() => el.classList.add('hidden'), duration);
}

/**
 * プログレスバーを更新する
 * @param {number} ratio 0〜1（1 以上で非表示になる）
 */
export function updateProgress(ratio) {
  const bar = document.getElementById('progress-bar');
  const fill = document.getElementById('progress-fill');
  if (ratio >= 1) {
    bar.classList.add('hidden');
    fill.style.width = '0%';
  } else {
    bar.classList.remove('hidden');
    fill.style.width = `${Math.round(ratio * 100)}%`;
  }
}

/**
 * モードに応じてUIを切り替える
 * @param {'view' | 'edit'} mode
 */
export function applyMode(mode) {
  const toggleBtn = document.getElementById('mode-toggle');
  const saveBtn = document.getElementById('save-btn');
  const addBtn = document.getElementById('add-label-btn');
  const upAxisGroup = document.getElementById('up-axis-group');
  const pdfFolderSetting = document.getElementById('pdf-folder-setting');

  if (mode === 'edit') {
    toggleBtn.textContent = '閲覧モードへ';
    saveBtn.classList.remove('hidden');
    addBtn.classList.remove('hidden');
    upAxisGroup.classList.remove('hidden');
    pdfFolderSetting.classList.remove('hidden');
  } else {
    toggleBtn.textContent = '編集モードへ';
    saveBtn.classList.add('hidden');
    addBtn.classList.add('hidden');
    upAxisGroup.classList.add('hidden');
    pdfFolderSetting.classList.add('hidden');
  }
}

/**
 * ラベル入力ダイアログを表示し、確定・キャンセルのコールバックを設定する
 * @param {(text: string) => void} onConfirm
 * @param {() => void} onCancel
 * @param {{ title?: string, placeholder?: string, multiline?: boolean, initial?: string }} [options]
 *   title/placeholder: タイトル・プレースホルダーを差し替える（ブックマーク名入力等への流用用）
 *   multiline: true で複数行入力（textarea）にする（スペック入力用）
 *   initial: フィールドの初期値
 */
export function showLabelDialog(onConfirm, onCancel,
    { title = 'ラベルテキストを入力', placeholder = '例: エンジン部', multiline = false, initial = '' } = {}) {
  const dialog = document.getElementById('label-dialog');
  const input = document.getElementById('label-input');
  const textarea = document.getElementById('label-textarea');
  const field = multiline ? textarea : input;
  const confirmBtn = document.getElementById('label-confirm');
  const cancelBtn = document.getElementById('label-cancel');

  if (!dialog.classList.contains('hidden')) return;
  document.getElementById('label-dialog-title').textContent = title;
  input.classList.toggle('hidden', multiline);
  textarea.classList.toggle('hidden', !multiline);
  field.placeholder = placeholder;
  field.value = initial;
  dialog.classList.remove('hidden');

  // フォーカスをタッチキーボード対応で遅延させる
  setTimeout(() => field.focus(), 50);

  function cleanup() {
    confirmBtn.removeEventListener('click', handleConfirm);
    cancelBtn.removeEventListener('click', handleCancel);
    field.removeEventListener('keydown', handleKey);
    dialog.classList.add('hidden');
  }

  function handleConfirm() {
    const text = field.value.trim();
    if (!text && !multiline) return;   // 複数行（スペック）は空で確定=クリア扱いを許可
    cleanup();
    onConfirm(text);
  }

  function handleCancel() {
    cleanup();
    onCancel?.();
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !multiline) handleConfirm();
    if (e.key === 'Escape') handleCancel();
  }

  confirmBtn.addEventListener('click', handleConfirm);
  cancelBtn.addEventListener('click', handleCancel);
  field.addEventListener('keydown', handleKey);
}
