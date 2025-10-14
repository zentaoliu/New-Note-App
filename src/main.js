const LOCAL_STORAGE_KEY = "study-note-app-state-v1";
const DEFAULT_TITLE = "高效学习记录实验";
const DEFAULT_SEGMENT_TEXT = `第一行：設定今天的學習目標，確認重點與節奏。
第二行：集中精神閱讀課文，標記需要復習的段落。
第三行：對複雜的概念做筆記，記錄自己的疑問。
第四行：完成練習題並檢查答案，找出錯誤的原因。
第五行：整理心得，思考下一次可以改進的地方。`;

const toastQueue = [];
let toastTimeout = null;

const state = {
  title: DEFAULT_TITLE,
  segments: [],
  notes: {},
  activeSegmentId: null,
  pendingEditor: null,
  selectionInfo: null,
};

function generateId(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function showToast(message, type = "success") {
  toastQueue.push({ id: generateId("toast"), message, type });
  renderToast();
}

function renderToast() {
  const container = document.getElementById("toast-container");
  if (!container) return;

  if (toastQueue.length === 0) {
    container.innerHTML = "";
    return;
  }

  const [current] = toastQueue;
  container.innerHTML = `<div class="toast ${current.type}">${current.message}</div>`;

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastQueue.shift();
    renderToast();
  }, 2200);
}

function loadState() {
  try {
    const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!cached) {
      initializeDefaultSegments();
      return;
    }
    const parsed = JSON.parse(cached);
    if (parsed.title) state.title = parsed.title;
    if (Array.isArray(parsed.segments)) state.segments = parsed.segments;
    if (parsed.notes && typeof parsed.notes === "object") state.notes = parsed.notes;
  } catch (error) {
    console.warn("Failed to load state:", error);
    initializeDefaultSegments();
  }
}

function initializeDefaultSegments() {
  state.title = DEFAULT_TITLE;
  state.segments = DEFAULT_SEGMENT_TEXT.split("\n").map((text) => ({
    id: generateId("segment"),
    text,
  }));
  state.notes = {};
}

function persistState() {
  const payload = {
    title: state.title,
    segments: state.segments,
    notes: state.notes,
  };
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Failed to persist state:", error);
  }
}

function getNoteBySegmentId(segmentId) {
  return state.notes[segmentId];
}

function setActiveSegment(segmentId) {
  state.activeSegmentId = segmentId;
  renderApp();
}

function clearActiveHighlight() {
  if (state.activeSegmentId === null) return;
  state.activeSegmentId = null;
  renderApp();
}

function clearSelection() {
  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
  }
  state.selectionInfo = null;
  hideToolbar();
}

function hideToolbar() {
  const toolbar = document.getElementById("selection-toolbar");
  if (toolbar) {
    toolbar.classList.add("hidden");
    toolbar.innerHTML = "";
  }
}

function positionToolbar(range) {
  const toolbar = document.getElementById("selection-toolbar");
  if (!toolbar || !range) return;
  const rect = range.getBoundingClientRect();
  const top = rect.top + window.scrollY;
  const left = rect.left + window.scrollX + rect.width / 2;
  toolbar.style.top = `${top}px`;
  toolbar.style.left = `${left}px`;
}

function showToolbar(actions, range) {
  const toolbar = document.getElementById("selection-toolbar");
  if (!toolbar) return;
  toolbar.innerHTML = actions
    .map((action) => `<button data-action="${action.type}">${action.label}</button>`)
    .join("");
  toolbar.classList.remove("hidden");
  positionToolbar(range);
}

function createNote(segmentId, content, selectionInfo) {
  const timestamp = new Date().toISOString();
  state.notes[segmentId] = {
    id: generateId("note"),
    segmentId,
    startOffset: selectionInfo?.startOffset ?? 0,
    endOffset: selectionInfo?.endOffset ?? 0,
    content,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.pendingEditor = null;
  state.activeSegmentId = segmentId;
  persistState();
  renderApp();
  showToast("备注已添加", "success");
}

function updateNote(segmentId, content) {
  const existing = getNoteBySegmentId(segmentId);
  if (!existing) return;
  existing.content = content;
  existing.updatedAt = new Date().toISOString();
  state.pendingEditor = null;
  state.activeSegmentId = segmentId;
  persistState();
  renderApp();
  showToast("备注已更新", "success");
}

function deleteNote(segmentId) {
  if (!state.notes[segmentId]) return;
  delete state.notes[segmentId];
  if (state.activeSegmentId === segmentId) {
    state.activeSegmentId = null;
  }
  state.pendingEditor = null;
  persistState();
  renderApp();
  showToast("备注已删除", "success");
}

function enterEditMode(segmentId) {
  const note = getNoteBySegmentId(segmentId);
  if (!note) return;
  state.pendingEditor = {
    segmentId,
    mode: "edit",
    content: note.content,
  };
  renderApp();
}

function enterCreateMode(segmentId, selectionInfo) {
  state.pendingEditor = {
    segmentId,
    mode: "create",
    content: "",
    selectionInfo,
  };
  renderApp();
}

function handleSelectionChange() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    state.selectionInfo = null;
    hideToolbar();
    return;
  }

  if (selection.isCollapsed) {
    state.selectionInfo = null;
    hideToolbar();
    return;
  }

  const range = selection.getRangeAt(0);
  const startSegmentEl = findSegmentTextElement(range.startContainer);
  const endSegmentEl = findSegmentTextElement(range.endContainer);

  if (!startSegmentEl || !endSegmentEl || startSegmentEl.dataset.segmentId !== endSegmentEl.dataset.segmentId) {
    hideToolbar();
    state.selectionInfo = null;
    if (!selection.isCollapsed && selection.toString().trim().length > 0) {
      showToast("请选择同一行文本", "error");
    }
    return;
  }

  const segmentId = startSegmentEl.dataset.segmentId;
  const text = range.toString();
  if (!text.trim()) {
    hideToolbar();
    state.selectionInfo = null;
    return;
  }

  const selectionInfo = {
    segmentId,
    startOffset: calculateOffset(startSegmentEl, range.startContainer, range.startOffset),
    endOffset: calculateOffset(startSegmentEl, range.endContainer, range.endOffset),
    text,
    range,
  };
  state.selectionInfo = selectionInfo;

  const note = getNoteBySegmentId(segmentId);
  if (note) {
    showToolbar(
      [
        { type: "view", label: "查看/编辑备注" },
      ],
      range
    );
  } else {
    showToolbar(
      [
        { type: "add", label: "添加备注" },
      ],
      range
    );
  }
}

function findSegmentTextElement(node) {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("segment-text")) {
    return node;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return node.parentElement ? node.parentElement.closest(".segment-text") : null;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    return node.closest(".segment-text");
  }
  return null;
}

function calculateOffset(root, node, nodeOffset) {
  let offset = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    const current = walker.currentNode;
    if (current === node) {
      return offset + nodeOffset;
    }
    offset += current.textContent.length;
  }
  return offset;
}

function handleToolbarClick(event) {
  const { target } = event;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  if (!action || !state.selectionInfo) return;
  const { segmentId, range } = state.selectionInfo;
  if (action === "add") {
    enterCreateMode(segmentId, state.selectionInfo);
  } else if (action === "view") {
    setActiveSegment(segmentId);
    const note = getNoteBySegmentId(segmentId);
    if (note) {
      state.pendingEditor = {
        segmentId,
        mode: "edit",
        content: note.content,
      };
    }
    renderApp();
  }
  state.selectionInfo = null;
  hideToolbar();
  if (range) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
  }
}

function renderControlPanel() {
  const segmentsText = state.segments.map((segment) => segment.text).join("\n");
  return `
    <section class="control-panel">
      <h1>学习记录软件</h1>
      <div class="field">
        <label for="title-input">标题</label>
        <input id="title-input" name="title" value="${escapeHtml(state.title)}" placeholder="请输入学习主题标题" />
      </div>
      <div class="field" style="margin-top:16px;">
        <label for="body-input">正文（每一行将作为一个可备注的片段）</label>
        <textarea id="body-input" name="body" placeholder="请输入正文，每行表示一个片段">${escapeHtml(segmentsText)}</textarea>
      </div>
      <div class="actions">
        <button class="primary" data-action="apply-body">更新正文</button>
        <button class="secondary" data-action="restore-default">恢复示例</button>
      </div>
    </section>
  `;
}

function renderSegment(segment) {
  const note = getNoteBySegmentId(segment.id);
  const isActive = state.activeSegmentId === segment.id;
  const hasNote = Boolean(note);
  const editing = state.pendingEditor && state.pendingEditor.segmentId === segment.id;

  return `
    <article class="segment ${hasNote ? "has-note" : ""} ${isActive ? "active" : ""}" data-segment-id="${segment.id}">
      <div class="segment-text" data-segment-id="${segment.id}">${escapeHtml(segment.text)}</div>
      ${renderNoteSection(segment, note, editing, isActive)}
    </article>
  `;
}

function renderNoteSection(segment, note, editing, isActive) {
  if (state.pendingEditor && state.pendingEditor.segmentId === segment.id) {
    const initial = state.pendingEditor.content || "";
    return `
      <div class="note-row note-editor ${isActive ? "active" : ""}" data-segment-id="${segment.id}">
        <label for="note-${segment.id}" style="font-weight:600;">备注</label>
        <textarea id="note-${segment.id}" data-role="note-input">${escapeHtml(initial)}</textarea>
        <div class="note-actions">
          <button class="primary" data-action="save-note" data-segment-id="${segment.id}">${state.pendingEditor.mode === "edit" ? "保存修改" : "保存备注"}</button>
          <button class="secondary" data-action="cancel-edit" data-segment-id="${segment.id}">取消</button>
        </div>
        <p style="margin:0;font-size:12px;color:#6b7280;">按 Enter 保存，Shift+Enter 换行</p>
      </div>
    `;
  }

  if (!note) return "";
  return `
    <div class="note-row ${isActive ? "active" : ""}" data-segment-id="${segment.id}">
      <div class="note-content">${escapeHtml(note.content)}</div>
      <div class="note-meta">更新于 ${formatDate(note.updatedAt)}</div>
      <div class="note-actions">
        <button class="secondary" data-action="edit-note" data-segment-id="${segment.id}">编辑</button>
        <button class="danger" data-action="delete-note" data-segment-id="${segment.id}">删除</button>
      </div>
    </div>
  `;
}

function renderSegmentList() {
  if (state.segments.length === 0) {
    return `<p style="color:#6b7280;">暂无正文内容，请先在上方输入正文。</p>`;
  }
  return `
    <section class="segment-list">
      ${state.segments.map((segment) => renderSegment(segment)).join("")}
    </section>
  `;
}

function renderApp() {
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = `${renderControlPanel()}${renderSegmentList()}`;
  attachEventListeners();
  if (state.pendingEditor) {
    const textarea = document.querySelector(`textarea#note-${state.pendingEditor.segmentId}`);
    if (textarea) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }
}

function attachEventListeners() {
  const app = document.getElementById("app");
  if (!app) return;

  const titleInput = document.getElementById("title-input");
  if (titleInput) {
    titleInput.addEventListener("input", (event) => {
      state.title = event.target.value;
      persistState();
    });
  }

  const bodyTextarea = document.getElementById("body-input");
  if (bodyTextarea) {
    bodyTextarea.addEventListener("input", (event) => {
      state.bodyDraft = event.target.value;
    });
  }

  app.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const action = event.currentTarget.dataset.action;
      const segmentId = event.currentTarget.dataset.segmentId;
      handleAction(action, segmentId);
    });
  });

  app.querySelectorAll("textarea[data-role='note-input']").forEach((textarea) => {
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        state.pendingEditor = null;
        renderApp();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const segmentId = textarea.closest(".note-row")?.dataset.segmentId;
        if (segmentId) {
          handleSaveNote(segmentId, textarea.value);
        }
      }
    });
  });

  app.querySelectorAll(".segment-text").forEach((element) => {
    element.addEventListener("click", () => {
      const segmentId = element.dataset.segmentId;
      const note = getNoteBySegmentId(segmentId);
      if (note) {
        setActiveSegment(segmentId);
      } else {
        clearActiveHighlight();
      }
    });
  });

  app.querySelectorAll(".note-row").forEach((element) => {
    element.addEventListener("click", () => {
      const segmentId = element.dataset.segmentId;
      setActiveSegment(segmentId);
    });
  });
}

function handleAction(action, segmentId) {
  switch (action) {
    case "apply-body":
      applyBodyUpdate();
      break;
    case "restore-default":
      initializeDefaultSegments();
      state.pendingEditor = null;
      state.activeSegmentId = null;
      persistState();
      renderApp();
      showToast("已恢复示例正文", "success");
      break;
    case "save-note":
      if (segmentId) {
        const textarea = document.querySelector(`#note-${segmentId}`);
        if (textarea) {
          handleSaveNote(segmentId, textarea.value);
        }
      }
      break;
    case "cancel-edit":
      state.pendingEditor = null;
      renderApp();
      break;
    case "edit-note":
      if (segmentId) {
        enterEditMode(segmentId);
      }
      break;
    case "delete-note":
      if (segmentId) {
        deleteNote(segmentId);
      }
      break;
    default:
      break;
  }
}

function applyBodyUpdate() {
  const bodyTextarea = document.getElementById("body-input");
  const titleInput = document.getElementById("title-input");
  const rawBody = bodyTextarea ? bodyTextarea.value : "";
  const title = titleInput ? titleInput.value : "";

  if (!rawBody.trim()) {
    showToast("正文不能为空", "error");
    return;
  }

  const lines = rawBody.split(/\r?\n/).map((line) => line.trimEnd());
  const filtered = lines.filter((line) => line.trim().length > 0);
  if (filtered.length === 0) {
    showToast("正文至少需要一行有效文本", "error");
    return;
  }

  state.segments = filtered.map((text) => ({ id: generateId("segment"), text }));
  state.notes = {};
  state.pendingEditor = null;
  state.activeSegmentId = null;
  state.title = title;
  persistState();
  renderApp();
  showToast("正文已更新，原有备注已清空", "success");
}

function handleSaveNote(segmentId, value) {
  const content = value.trim();
  if (!content) {
    showToast("备注内容不能为空", "error");
    return;
  }
  const note = getNoteBySegmentId(segmentId);
  if (note) {
    updateNote(segmentId, content);
  } else {
    createNote(segmentId, content, state.pendingEditor?.selectionInfo ?? state.selectionInfo);
  }
}

function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function handleDocumentClick(event) {
  const target = event.target;
  if (!(target instanceof Node)) return;
  const toolbar = document.getElementById("selection-toolbar");
  if (toolbar && toolbar.contains(target)) {
    return;
  }
  const segment = target instanceof HTMLElement ? target.closest(".segment") : null;
  if (!segment) {
    clearActiveHighlight();
  }
}

function setupGlobalListeners() {
  const toolbar = document.getElementById("selection-toolbar");
  if (toolbar) {
    toolbar.addEventListener("click", handleToolbarClick);
  }

  document.addEventListener("selectionchange", handleSelectionChange);
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      clearSelection();
      if (state.pendingEditor) {
        state.pendingEditor = null;
        renderApp();
      }
    }
  });

  window.addEventListener("scroll", () => {
    if (state.selectionInfo?.range) {
      positionToolbar(state.selectionInfo.range);
    }
  });
  window.addEventListener("resize", () => {
    if (state.selectionInfo?.range) {
      positionToolbar(state.selectionInfo.range);
    }
  });
}

function init() {
  loadState();
  if (state.segments.length === 0) {
    initializeDefaultSegments();
  }
  renderApp();
  setupGlobalListeners();
}

init();
