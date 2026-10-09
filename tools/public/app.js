const $ = (selector) => document.querySelector(selector);
const state = { date: new Date(), events: [], editing: null, duplicating: null, imageSelection: null, draggingId: null, pendingSave: null, additionalDates: new Set(), pickerDate: new Date(), initialForm: null };
const monthNames = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

const api = async (path, options = {}) => {
  const response = await fetch(`api${path}`, { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || 'No se pudo completar la operación');
  return data;
};
const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseDate = (value) => new Date(String(value).replace(' ', 'T'));
const formatWpDate = (date) => `${iso(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:00`;
const formatTime = (value) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(parseDate(value));
const formatCreatedAt = (value) => value ? `Creado el ${new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))}` : 'Se mostrará después de guardar';
function formDateTimes() {
  const date = $('#event-date').value;
  const startTime = $('#start-time').value;
  const endTime = $('#end-time').value;
  const nextDay = endTime <= startTime ? iso(new Date(new Date(`${date}T12:00:00`).getTime() + 86400000)) : date;
  return { start: `${date} ${startTime}:00`, end: `${nextDay} ${endTime}:00`, overnight: nextDay !== date };
}

// El loader va en la capa superior del navegador (popover) para quedar siempre por encima de los <dialog> modales.
const loadingEl = $('#loading');
const loadingUsesPopover = typeof loadingEl.showPopover === 'function';
if (loadingUsesPopover) { loadingEl.setAttribute('popover', 'manual'); loadingEl.classList.remove('hidden'); }
function setLoading(active, label = 'Cargando calendario') {
  $('#loading-label').textContent = label;
  if (!loadingUsesPopover) return loadingEl.classList.toggle('hidden', !active);
  const open = loadingEl.matches(':popover-open');
  if (active && !open) loadingEl.showPopover();
  else if (!active && open) loadingEl.hidePopover();
}
function startOfGrid(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const day = (first.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), 1 - day);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function showImagePreview(url) {
  const preview = $('#image-preview');
  if (!url) { preview.innerHTML = '<span class="preview-empty">Este evento todavía no tiene imagen.</span>'; preview.classList.remove('hidden'); return; }
  preview.innerHTML = `<img src="image-proxy?url=${encodeURIComponent(url)}" alt="Vista previa de la imagen"><span>Imagen actual del evento</span>`;
  preview.classList.remove('hidden');
  const image = preview.querySelector('img');
  image.addEventListener('click', () => openImageDialog(image.src));
  image.addEventListener('error', () => { preview.innerHTML = '<span class="preview-empty">No se ha podido cargar la imagen actual.</span>'; });
}
function openImageDialog(src) { $('#full-image').src = src; $('#image-dialog').showModal(); }
function render() {
  const calendar = $('#calendar');
  calendar.innerHTML = '';
  ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'].forEach((dayName) => {
    const heading = document.createElement('div');
    heading.className = 'weekday'; heading.textContent = dayName; calendar.append(heading);
  });
  const cursor = startOfGrid(state.date);
  for (let index = 0; index < 42; index += 1) {
    const day = new Date(cursor); day.setDate(cursor.getDate() + index);
    const cell = document.createElement('div');
    cell.className = `day ${day.getMonth() !== state.date.getMonth() ? 'other' : ''} ${iso(day) === iso(new Date()) ? 'today' : ''}`;
    cell.innerHTML = `<span class="day-number">${day.getDate()}</span>`;
    state.events.filter((event) => event.start?.slice(0, 10) === iso(day)).forEach((event) => {
      const chip = document.createElement('button');
      chip.className = `event-chip ${event.status}`;
      if (/^#[0-9a-f]{6}$/i.test(event.color || '')) { chip.classList.add('custom-color'); chip.style.setProperty('--event-color', event.color); }
      chip.draggable = true;
      chip.innerHTML = `<span class="event-time">${formatTime(event.start)}</span>${escapeHtml(event.title)}`;
      chip.onclick = () => openDialog(event);
      chip.ondragstart = (dragEvent) => { state.draggingId = event.id; chip.classList.add('dragging'); dragEvent.dataTransfer.effectAllowed = 'move'; dragEvent.dataTransfer.setData('text/plain', String(event.id)); };
      chip.ondragend = () => { state.draggingId = null; chip.classList.remove('dragging'); document.querySelectorAll('.drop-target').forEach((target) => target.classList.remove('drop-target')); };
      cell.append(chip);
    });
    cell.ondragover = (dragEvent) => { dragEvent.preventDefault(); cell.classList.add('drop-target'); };
    cell.ondragleave = () => cell.classList.remove('drop-target');
    cell.ondrop = (dropEvent) => { dropEvent.preventDefault(); cell.classList.remove('drop-target'); moveEventToDay(Number(dropEvent.dataTransfer.getData('text/plain')), day); };
    cell.onclick = (clickEvent) => { if (clickEvent.target === cell) openDialog(null, day); };
    calendar.append(cell);
  }
  $('#month-label').textContent = `${monthNames[state.date.getMonth()]} ${state.date.getFullYear()}`;
}
async function load() {
  setLoading(true, 'Cargando calendario');
  const start = new Date(state.date.getFullYear(), state.date.getMonth(), 1);
  const end = new Date(state.date.getFullYear(), state.date.getMonth() + 1, 0);
  $('#status-message').textContent = '';
  try {
    state.events = await api(`/events?start=${encodeURIComponent(`${iso(start)} 00:00:00`)}&end=${encodeURIComponent(`${iso(end)} 23:59:59`)}`);
    render();
    $('#status-message').textContent = `${state.events.length} eventos`;
  } catch (error) { $('#status-message').textContent = error.message; }
  finally { setLoading(false); }
}
function openDialog(event, day) {
  state.editing = event; state.duplicating = null; state.imageSelection = null; state.additionalDates = new Set();
  $('#event-form').reset(); $('#event-id').value = event?.id || '';
  $('#dialog-title').textContent = event ? 'Editar evento' : 'Añadir evento';
  $('#title').value = event?.title || ''; $('#description').value = event?.description_clean || event?.description || '';
  state.originalDescription = event?.description || ''; state.originalDescriptionClean = event?.description_clean || event?.description || '';
  $('#status').value = 'publish';
  $('#event-color').value = /^#[0-9a-f]{6}$/i.test(event?.color || '') ? event.color : '#1d6b4b';
  $('#save-event').textContent = event ? 'Actualizar evento' : 'Guardar evento';
  $('#created-info').textContent = formatCreatedAt(event?.created_at);
  $('#event-date').value = event?.start?.slice(0, 10) || iso(day || state.date);
  $('#start-time').value = event?.start?.slice(11, 16) || '20:00';
  $('#end-time').value = event?.end?.slice(11, 16) || '22:00';
  $('#choose-additional-days').classList.toggle('hidden', Boolean(event));
  updateAdditionalDaysInfo();
  $('#cancel-event').classList.toggle('hidden', !event); $('#duplicate-event').classList.toggle('hidden', !event);
  showImagePreview(event?.image || ''); $('#event-dialog').showModal();
  state.initialForm = { title: $('#title').value, description: $('#description').value, date: $('#event-date').value, start: $('#start-time').value, end: $('#end-time').value, status: $('#status').value, repeat: $('#repeat').value, color: $('#event-color').value };
}
function openDuplicateDialog(event) {
  openDialog(event);
  state.editing = null; state.duplicating = event;
  $('#dialog-title').textContent = 'Duplicar evento';
  $('#status').value = 'publish';
  $('#save-event').textContent = 'Guardar evento';
  $('#cancel-event').classList.add('hidden');
  $('#duplicate-event').classList.add('hidden');
  $('#choose-additional-days').classList.remove('hidden');
}
function closeDialog() { $('#event-dialog').close(); state.editing = null; state.duplicating = null; state.imageSelection = null; }
function updateAdditionalDaysInfo() {
  const count = state.additionalDates.size;
  $('#additional-days-info').textContent = count ? `${count} día${count === 1 ? '' : 's'} adicional${count === 1 ? '' : 'es'} seleccionado${count === 1 ? '' : 's'}.` : 'Puedes seleccionar días adicionales para este mismo evento.';
}
function renderAdditionalDays() {
  const calendar = $('#multi-calendar'); calendar.innerHTML = '';
  const first = new Date(state.pickerDate.getFullYear(), state.pickerDate.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  $('#picker-month').textContent = `${monthNames[state.pickerDate.getMonth()]} ${state.pickerDate.getFullYear()}`;
  ['L','M','X','J','V','S','D'].forEach((name) => { const heading = document.createElement('span'); heading.className = 'picker-weekday'; heading.textContent = name; calendar.append(heading); });
  for (let index = 0; index < 42; index += 1) {
    const day = new Date(first.getFullYear(), first.getMonth(), index - offset + 1); const key = iso(day); const button = document.createElement('button');
    button.type = 'button'; button.className = `picker-day ${day.getMonth() !== first.getMonth() ? 'other' : ''} ${state.additionalDates.has(key) ? 'selected' : ''}`; button.textContent = day.getDate();
    button.onclick = () => { if (key === $('#event-date').value) return; state.additionalDates.has(key) ? state.additionalDates.delete(key) : state.additionalDates.add(key); renderAdditionalDays(); };
    calendar.append(button);
  }
  const selected = [...state.additionalDates].sort(); $('#selected-days-label').textContent = selected.length ? `Seleccionados: ${selected.map((value) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(parseDate(`${value} 12:00`))).join(', ')}` : 'No has seleccionado días adicionales.';
}
function openAdditionalDays() { state.pickerDate = parseDate(`${$('#event-date').value} 12:00`); renderAdditionalDays(); $('#additional-days-dialog').showModal(); }
function fileToPayload(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ filename: file.name, type: file.type, data: String(reader.result).split(',')[1] }); reader.onerror = reject; reader.readAsDataURL(file); });
}
function showSaveSummary() {
  const formTimes = formDateTimes();
  const start = parseDate(formTimes.start);
  const end = parseDate(formTimes.end);
  const status = { draft: 'borrador', pending: 'pendiente', publish: 'publicado' }[$('#status').value];
  const repeat = { none: 'No se repite', daily: 'Cada día', weekly: 'Cada semana' }[$('#repeat').value];
  $('#confirm-save').textContent = state.pendingSave?.editingId ? 'Actualizar evento' : 'Subir evento';
  $('#save-summary').innerHTML = `<div><strong>${escapeHtml($('#title').value)}</strong></div><div>Del ${new Intl.DateTimeFormat('es-ES', { dateStyle: 'full', timeStyle: 'short' }).format(start)} al ${new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(end)}${formTimes.overnight ? ' (termina al día siguiente)' : ''}</div><div>Estado: <strong>${status}</strong> · ${repeat}</div><div>${state.imageSelection || state.duplicating?.image_id ? 'Con imagen' : 'Sin imagen nueva'}</div>`;
  $('#save-confirm-dialog').showModal();
}
function currentEventPayload() {
  const descriptionChanged = $('#description').value !== (state.originalDescriptionClean || '');
  return {
    title: $('#title').value,
    description: descriptionChanged ? $('#description').value : (state.originalDescription || $('#description').value),
    ...formDateTimes(),
    status: $('#status').value,
    color: $('#event-color').value,
    recurrence: { frequency: $('#repeat').value, until: $('#repeat-until').value }
  };
}
function hasNonColorChanges() {
  if (!state.initialForm) return false;
  return ['title', 'description', 'date', 'start', 'end', 'status', 'repeat'].some((field) => state.initialForm[field] !== ({ title: $('#title').value, description: $('#description').value, date: $('#event-date').value, start: $('#start-time').value, end: $('#end-time').value, status: $('#status').value, repeat: $('#repeat').value }[field]));
}
async function saveColorAutomatically() {
  if (!state.editing || hasNonColorChanges() || state.initialForm?.color === $('#event-color').value) return;
  const editedEvent = state.editing;
  if ($('#event-dialog').open) $('#event-dialog').close();
  setLoading(true, 'Actualizando color');
  try {
    const saved = await api(`/events/${editedEvent.id}`, { method: 'PUT', body: JSON.stringify({ ...currentEventPayload(), status: editedEvent.status }) });
    await load(); setLoading(false); openDialog(saved); $('#status-message').textContent = 'Color actualizado automáticamente';
  } catch (error) { setLoading(false); $('#form-error').textContent = error.message; $('#event-dialog').showModal(); }
}
function save(event) {
  event.preventDefault(); $('#form-error').textContent = ''; showSaveSummary();
}
async function performSave() {
  const pending = state.pendingSave;
  const wasDuplicating = Boolean(pending?.wasDuplicating);
  const duplicateSource = pending?.duplicateSource;
  const editingId = pending?.editingId || null;
  const editingEvent = pending?.editingEvent || null;
  const payload = pending?.payload || {};
  $('#save-confirm-dialog').close();
  // El formulario es un <dialog> nativo y queda por encima del loader si sigue abierto.
  // Lo cerramos antes de mostrar la carga para que el usuario vea el estado real.
  if ($('#event-dialog').open) $('#event-dialog').close();
  setLoading(true, 'Subiendo evento');
  try {
    let imageId;
    if (pending?.imageSelection) imageId = (await api('/media', { method: 'POST', body: JSON.stringify(pending.imageSelection) })).id;
    if (imageId) payload.image_id = imageId;
    if (duplicateSource?.image_id) payload.image_id = duplicateSource.image_id;
    const saved = wasDuplicating ? await api('/events', { method: 'POST', body: JSON.stringify(payload) }) : editingId ? await api(`/events/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) }) : await api('/events', { method: 'POST', body: JSON.stringify(payload) });
    if (wasDuplicating) state.date = parseDate(saved.start);
    closeDialog(); await load();
    setLoading(false);
    const wasUpdating = Boolean(editingId);
    $('#status-message').textContent = wasUpdating ? 'Evento actualizado correctamente' : 'Evento subido correctamente';
    $('#success-title').textContent = wasUpdating ? 'Evento actualizado correctamente' : 'Evento subido correctamente';
    $('#success-message').textContent = `“${saved.title}” se ha guardado como ${saved.status === 'publish' ? 'publicado' : saved.status === 'pending' ? 'pendiente' : 'borrador'}.`;
    const viewButton = $('#view-event'); viewButton.classList.toggle('hidden', !saved.url); viewButton.onclick = () => window.open(saved.url, '_blank', 'noopener');
    $('#success-dialog').showModal();
    state.pendingSave = null;
  } catch (error) {
    setLoading(false);
    state.editing = editingEvent; state.duplicating = duplicateSource;
    $('#form-error').textContent = error.message; $('#event-dialog').showModal();
  }
}
async function moveEventToDay(id, day) {
  const event = state.events.find((item) => item.id === id); if (!event) return;
  const oldStart = parseDate(event.start); const oldEnd = parseDate(event.end); const duration = oldEnd - oldStart;
  const newStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), oldStart.getHours(), oldStart.getMinutes());
  const payload = { title: event.title, description: event.description || '', start: formatWpDate(newStart), end: formatWpDate(new Date(newStart.getTime() + duration)), status: event.status };
  setLoading(true, 'Moviendo evento');
  try { await api(`/events/${id}`, { method: 'PUT', body: JSON.stringify(payload) }); $('#status-message').textContent = 'Evento movido correctamente'; await load(); } catch (error) { $('#status-message').textContent = error.message; } finally { setLoading(false); }
}
function enterApp() { $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); load(); }
$('#login-form').onsubmit = async (event) => { event.preventDefault(); $('#login-error').textContent = ''; try { const response = await fetch('auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: $('#access-code').value }) }); if (!response.ok) throw new Error((await response.json()).error); enterApp(); } catch (error) { $('#login-error').textContent = error.message; } };
$('#event-form').onsubmit = (event) => {
  const payload = currentEventPayload();
  state.pendingSave = {
    wasDuplicating: Boolean(state.duplicating),
    duplicateSource: state.duplicating,
    editingId: state.editing?.id || null,
    editingEvent: state.editing,
    imageSelection: state.imageSelection,
    payload: { ...payload, additional_dates: [...state.additionalDates].sort() }
  };
  save(event);
};
$('#close-dialog').onclick = closeDialog; $('#new-event').onclick = () => openDialog();
$('#image').onchange = async () => { const file = $('#image').files[0]; if (!file) return; state.imageSelection = await fileToPayload(file); showImagePreview(URL.createObjectURL(file)); };
$('#event-color').onchange = saveColorAutomatically;
$('#prev-month').onclick = () => { state.date = new Date(state.date.getFullYear(), state.date.getMonth() - 1, 1); load(); };
$('#next-month').onclick = () => { state.date = new Date(state.date.getFullYear(), state.date.getMonth() + 1, 1); load(); };
$('#today').onclick = () => { state.date = new Date(); load(); };
$('#repeat').onchange = () => $('#repeat-until-wrap').classList.toggle('hidden', $('#repeat').value === 'none');
$('#cancel-event').onclick = () => { if (state.editing) $('#confirm-dialog').showModal(); };
$('#close-confirm').onclick = () => $('#confirm-dialog').close();
$('#confirm-cancel').onclick = async () => { if (!state.editing) return; $('#confirm-dialog').close(); setLoading(true, 'Cancelando evento'); try { await api(`/events/${state.editing.id}`, { method: 'DELETE' }); closeDialog(); await load(); $('#status-message').textContent = 'Evento cancelado y enviado a la papelera'; } catch (error) { $('#form-error').textContent = error.message; } finally { setLoading(false); } };
$('#close-image').onclick = () => $('#image-dialog').close();
$('#duplicate-event').onclick = () => { if (state.editing) openDuplicateDialog(state.editing); };
$('#close-save-confirm').onclick = () => { $('#save-confirm-dialog').close(); state.pendingSave = null; };
$('#confirm-save').onclick = performSave;
$('#close-success').onclick = () => $('#success-dialog').close();
$('#choose-additional-days').onclick = openAdditionalDays;
$('#picker-prev').onclick = () => { state.pickerDate = new Date(state.pickerDate.getFullYear(), state.pickerDate.getMonth() - 1, 1); renderAdditionalDays(); };
$('#picker-next').onclick = () => { state.pickerDate = new Date(state.pickerDate.getFullYear(), state.pickerDate.getMonth() + 1, 1); renderAdditionalDays(); };
$('#close-additional-days').onclick = () => $('#additional-days-dialog').close();
$('#cancel-additional-days').onclick = () => $('#additional-days-dialog').close();
$('#apply-additional-days').onclick = () => { $('#additional-days-dialog').close(); updateAdditionalDaysInfo(); };
fetch('auth/check').then((response) => { if (response.ok) enterApp(); });
