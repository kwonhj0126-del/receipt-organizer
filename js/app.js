// ============================================================================
// 영수정리 — 모든 처리는 이 브라우저 안에서만 이루어집니다.
// (서버로 이미지나 데이터를 전송하지 않습니다)
// ============================================================================

const CATEGORIES = ['식비', '교통', '사무용품', '숙박', '접대비', '기타'];

/** 영수증 한 장에 대한 데이터 모델 */
let receipts = []; // { id, fileName, thumbnail, date, vendor, category, amount, status, rawText }
let idCounter = 0;

// ------------------------------------------------------------------
// DOM 참조
// ------------------------------------------------------------------
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const tableBody = document.getElementById('receiptTableBody');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const categoryFilter = document.getElementById('categoryFilter');
const clearAllBtn = document.getElementById('clearAllBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const exportExcelBtn = document.getElementById('exportExcelBtn');
const toastEl = document.getElementById('toast');

const summaryCount = document.getElementById('summaryCount');
const summaryDone = document.getElementById('summaryDone');
const summaryTopCategory = document.getElementById('summaryTopCategory');
const summaryTotal = document.getElementById('summaryTotal');

// ------------------------------------------------------------------
// 업로드 UI (드래그앤드롭 + 클릭)
// ------------------------------------------------------------------
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});

['dragenter', 'dragover'].forEach(evt => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
});
['dragleave', 'drop'].forEach(evt => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
  });
});
dropzone.addEventListener('drop', (e) => {
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  if (files.length) handleFiles(files);
});
fileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  if (files.length) handleFiles(files);
  fileInput.value = '';
});

function handleFiles(files) {
  files.forEach(file => {
    const id = ++idCounter;
    const reader = new FileReader();
    reader.onload = (e) => {
      const receipt = {
        id,
        fileName: file.name,
        thumbnail: e.target.result,
        date: '',
        vendor: '',
        category: '기타',
        amount: 0,
        status: 'pending', // pending | processing | done | error
        rawText: ''
      };
      receipts.push(receipt);
      render();
      runOcr(receipt);
    };
    reader.readAsDataURL(file);
  });
}

// ------------------------------------------------------------------
// OCR — Claude API 호출 (/api/ocr 서버리스 함수 경유)
// ------------------------------------------------------------------
function compressImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1024;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else { width = Math.round(width * MAX / height); height = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = dataUrl;
  });
}
async function runOcr(receipt) {
  receipt.status = 'processing';
  render();
  try {
    // base64에서 헤더(data:image/jpeg;base64,) 제거
    const compressed = await compressImage(receipt.thumbnail);
    const [meta, base64Data] = compressed.split(',');
    const mediaType = 'image/jpeg';

    const res = await fetch('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Data, mediaType })
    });

    if (!res.ok) throw new Error(`서버 오류: ${res.status}`);

    const data = await res.json();
    receipt.date     = data.date     || '';
    receipt.vendor   = data.vendor   || receipt.fileName.replace(/\.[^.]+$/, '');
    receipt.amount   = Number(data.amount) || 0;
    receipt.category = data.category || '기타';
    receipt.status   = 'done';
  } catch (err) {
    console.error('OCR 오류:', err);
    receipt.status = 'error';
    receipt.vendor = receipt.fileName.replace(/\.[^.]+$/, '');
  }
  render();
}

// ------------------------------------------------------------------
// 렌더링
// ------------------------------------------------------------------
function getFiltered() {
  const q = searchInput.value.trim().toLowerCase();
  const cat = categoryFilter.value;
  return receipts.filter(r => {
    const matchesQuery = !q || r.vendor.toLowerCase().includes(q) || r.category.toLowerCase().includes(q) || r.fileName.toLowerCase().includes(q);
    const matchesCategory = !cat || r.category === cat;
    return matchesQuery && matchesCategory;
  });
}

function render() {
  const list = getFiltered().slice().sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));

  tableBody.innerHTML = '';
  emptyState.style.display = receipts.length === 0 ? 'block' : 'none';
  document.getElementById('receiptTable').style.display = receipts.length === 0 ? 'none' : 'table';

  list.forEach(r => {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>
        <div class="cell-thumb">
          <img src="${r.thumbnail}" alt="${escapeHtml(r.fileName)} 영수증 미리보기">
          <span class="file-name">${escapeHtml(r.fileName)}</span>
        </div>
      </td>
      <td><input class="editable-input" type="date" data-id="${r.id}" data-field="date" value="${r.date}"></td>
      <td><input class="editable-input" type="text" data-id="${r.id}" data-field="vendor" value="${escapeHtml(r.vendor)}" placeholder="상호 / 항목명"></td>
      <td>
        <select class="editable-input" data-id="${r.id}" data-field="category">
          ${CATEGORIES.map(c => `<option value="${c}" ${c === r.category ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </td>
      <td><input class="editable-input amount-input" type="number" min="0" step="10" data-id="${r.id}" data-field="amount" value="${r.amount}"></td>
      <td>${statusBadge(r.status)}</td>
      <td><button class="row-remove" data-id="${r.id}" aria-label="삭제">
        <svg class="icon" viewBox="0 0 24 24" style="width:18px;height:18px"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
      </button></td>
    `;
    tableBody.appendChild(tr);
  });

  bindRowEvents();
  updateSummary();
  updateProcessingOverlay();
}

function statusBadge(status) {
  switch (status) {
    case 'processing':
      return `<span class="status-badge status-processing"><svg class="icon spin" viewBox="0 0 24 24" style="width:12px;height:12px"><path d="M12 3a9 9 0 1 0 9 9"/></svg>인식 중</span>`;
    case 'done':
      return `<span class="status-badge status-done"><svg class="icon" viewBox="0 0 24 24" style="width:12px;height:12px"><path d="m5 13 4 4L19 7"/></svg>완료</span>`;
    case 'error':
      return `<span class="status-badge status-error"><svg class="icon" viewBox="0 0 24 24" style="width:12px;height:12px"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>확인 필요</span>`;
    default:
      return `<span class="status-badge status-pending">대기 중</span>`;
  }
}

function bindRowEvents() {
  // 썸네일 클릭 → 모달 열기
  tableBody.querySelectorAll('.cell-thumb img').forEach(img => {
    img.addEventListener('click', () => {
      const id = Number(img.closest('tr').querySelector('.editable-input').dataset.id);
      const receipt = receipts.find(r => r.id === id);
      if (receipt) openImgModal(receipt.thumbnail, receipt.fileName);
    });
  });

  tableBody.querySelectorAll('.editable-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const id = Number(e.target.dataset.id);
      const field = e.target.dataset.field;
      const receipt = receipts.find(r => r.id === id);
      if (!receipt) return;
      receipt[field] = field === 'amount' ? Number(e.target.value) || 0 : e.target.value;
      updateSummary();
    });
  });
  tableBody.querySelectorAll('.row-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = Number(e.currentTarget.dataset.id);
      receipts = receipts.filter(r => r.id !== id);
      render();
      showToast('삭제했어요');
    });
  });
}

function updateSummary() {
  const list = getFiltered();
  const total = list.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const done = list.filter(r => r.status === 'done').length;

  const catCount = {};
  list.forEach(r => { catCount[r.category] = (catCount[r.category] || 0) + 1; });
  const topCategory = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a])[0];

  summaryCount.textContent = `${list.length}장`;
  summaryDone.textContent = `${done}건`;
  summaryTopCategory.textContent = topCategory ? topCategory : '–';
  summaryTotal.textContent = `${total.toLocaleString('ko-KR')}원`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ------------------------------------------------------------------
// 검색 / 필터
// ------------------------------------------------------------------
searchInput.addEventListener('input', render);
categoryFilter.addEventListener('change', render);

clearAllBtn.addEventListener('click', () => {
  if (!receipts.length) return;
  if (confirm('올린 영수증을 모두 삭제할까요? 다운로드하지 않은 내용은 사라져요.')) {
    receipts = [];
    render();
    showToast('전체 삭제했어요');
  }
});

// ------------------------------------------------------------------
// 내보내기 — 엑셀 (SheetJS)
// ------------------------------------------------------------------
exportExcelBtn.addEventListener('click', () => {
  const list = getFiltered();
  if (!list.length) { showToast('내려받을 영수증이 없어요'); return; }

  const rows = list.map(r => ({
    날짜: r.date || '',
    '항목 / 상호': r.vendor,
    카테고리: r.category,
    금액: Number(r.amount) || 0
  }));
  rows.push({ 날짜: '', '항목 / 상호': '', 카테고리: '합계', 금액: rows.reduce((s, r) => s + r.금액, 0) });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 12 }, { wch: 26 }, { wch: 12 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '영수증 정리');
  XLSX.writeFile(wb, `영수증정리_${todayStr()}.xlsx`);
  showToast('엑셀 파일을 내려받았어요');
});

// ------------------------------------------------------------------
// 내보내기 — PDF (jsPDF + autotable)
// ------------------------------------------------------------------
exportPdfBtn.addEventListener('click', () => {
  const list = getFiltered();
  if (!list.length) { showToast('내려받을 영수증이 없어요'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const total = list.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  doc.setFontSize(14);
  doc.text('Receipt Summary', 14, 18);
  doc.setFontSize(9);
  doc.text(`Generated: ${todayStr()}   Total items: ${list.length}   Total: ${total.toLocaleString('en-US')} KRW`, 14, 25);

  doc.autoTable({
    startY: 32,
    head: [['Date', 'Vendor / Item', 'Category', 'Amount (KRW)']],
    body: list.map(r => [r.date || '-', r.vendor || '-', r.category, (Number(r.amount) || 0).toLocaleString('en-US')]),
    styles: { font: 'helvetica', fontSize: 9 },
    headStyles: { fillColor: [59, 130, 246] },
    foot: [['', '', 'Total', total.toLocaleString('en-US')]],
    footStyles: { fillColor: [249, 250, 251], textColor: [31, 41, 55], fontStyle: 'bold' }
  });

  doc.save(`receipts_${todayStr()}.pdf`);
  showToast('PDF 파일을 내려받았어요');
});

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// ------------------------------------------------------------------
// 토스트
// ------------------------------------------------------------------
let toastTimer;
function showToast(msg) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// ------------------------------------------------------------------
// 이미지 미리보기 모달
// ------------------------------------------------------------------
const imgModalBackdrop = document.getElementById('imgModalBackdrop');
const imgModalImg = document.getElementById('imgModalImg');
const imgModalFileName = document.getElementById('imgModalFileName');
const imgModalClose = document.getElementById('imgModalClose');

function openImgModal(src, fileName) {
  imgModalImg.src = src;
  imgModalFileName.textContent = fileName;
  imgModalBackdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeImgModal() {
  imgModalBackdrop.classList.remove('open');
  document.body.style.overflow = '';
  imgModalImg.src = '';
}

imgModalClose.addEventListener('click', closeImgModal);
imgModalBackdrop.addEventListener('click', (e) => {
  if (e.target === imgModalBackdrop) closeImgModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeImgModal();
});

// ------------------------------------------------------------------
// FAQ 아코디언
// ------------------------------------------------------------------
document.querySelectorAll('.faq-item').forEach(item => {
  const btn = item.querySelector('.faq-question');
  btn.addEventListener('click', () => {
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
    if (!isOpen) item.classList.add('open');
  });
});

// ------------------------------------------------------------------
// 모바일 메뉴 토글
// ------------------------------------------------------------------
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');

navToggle?.addEventListener('click', () => {
  navLinks.classList.toggle('mobile-open');
});

// 메뉴 링크 클릭 시 닫기
navLinks?.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => navLinks.classList.remove('mobile-open'));
});

// 메뉴 바깥 클릭 시 닫기
document.addEventListener('click', (e) => {
  if (!navLinks.contains(e.target) && !navToggle.contains(e.target)) {
    navLinks.classList.remove('mobile-open');
  }
});

// ------------------------------------------------------------------
// 인식 중 오버레이
// ------------------------------------------------------------------
const processingOverlay = document.getElementById('processingOverlay');
const processingText = document.getElementById('processingText');

function updateProcessingOverlay() {
  const processing = receipts.filter(r => r.status === 'processing').length;
  const pending = receipts.filter(r => r.status === 'pending').length;
  const total = processing + pending;
  if (total > 0) {
    processingOverlay.classList.remove('hidden');
    processingText.textContent = `AI가 영수증을 읽고 있어요... (${total}장 남음)`;
  } else {
    processingOverlay.classList.add('hidden');
  }
}

// ------------------------------------------------------------------
// 초기 렌더
// ------------------------------------------------------------------
render();
