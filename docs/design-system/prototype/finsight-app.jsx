const { Button, FeatureCard, PricingTierCard } = window.FinsightDesignSystem_dda60d;
const DATA = window.__finsightData;
const { useState, useEffect, useRef } = React;

const ACCOUNTS = ['접대비', '식비', '소모품비', '통신비', '여비교통비', '광고선전비', '도서인쇄비', '기타'];
const SAMPLE_COUNT = 20;
const won = (n) => n.toLocaleString('ko-KR') + '원';
const nextCategory = (c) => (c === '사업경비' ? '개인지출' : c === '개인지출' ? '확인필요' : '사업경비');

const ICON_PATHS = {
  'upload-cloud': [['path', { d: 'M16 16l-4-4-4 4' }], ['path', { d: 'M12 12v9' }], ['path', { d: 'M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 104 16.3' }]],
  'check': [['polyline', { points: '20 6 9 17 4 12' }]],
  'lock': [['rect', { x: 3, y: 11, width: 18, height: 11, rx: 2 }], ['path', { d: 'M7 11V7a5 5 0 0110 0v4' }]],
  'shield-check': [['path', { d: 'M12 2l8 4v6c0 5-4 8-8 9-4-1-8-4-8-9V6l8-4z' }], ['polyline', { points: '9 12 11 14 15 10' }]],
  'send': [['path', { d: 'M22 2 11 13' }], ['path', { d: 'M22 2 15 22 11 13 2 9 22 2' }]],
  'x': [['line', { x1: 18, y1: 6, x2: 6, y2: 18 }], ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }]],
  'info': [['circle', { cx: 12, cy: 12, r: 10 }], ['line', { x1: 12, y1: 16, x2: 12, y2: 12 }], ['line', { x1: 12, y1: 8, x2: 12.01, y2: 8 }]],
  'check-circle-2': [['circle', { cx: 12, cy: 12, r: 10 }], ['polyline', { points: '9 12 11 14 15 10' }]],
  'user': [['circle', { cx: 12, cy: 7, r: 4 }], ['path', { d: 'M5.5 21a6.5 6.5 0 0113 0' }]],
  'mail': [['rect', { x: 2, y: 4, width: 20, height: 16, rx: 2 }], ['polyline', { points: '22 6 12 13 2 6' }]],
};
function Icon({ name, style }) {
  const parts = ICON_PATHS[name] || [];
  return React.createElement('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style },
    parts.map((p, i) => React.createElement(p[0], { key: i, ...p[1] })));
}
function useIcons() {}

function StatusTag({ category, onClick }) {
  const cls = category === '사업경비' ? 'biz' : category === '개인지출' ? 'personal' : 'review';
  return React.createElement('button', { className: 'status-tag ' + cls, onClick }, [
    React.createElement('span', { key: 'd', className: 'dot' }),
    category,
  ]);
}

function Header({ screen, plan, onNav, onReset }) {
  const showTabs = screen === 'table' || screen === 'qa';
  return React.createElement('div', { className: 'appbar' },
    React.createElement('div', { className: 'container' }, [
      React.createElement('div', { key: 'w', className: 'wordmark', onClick: onReset }, [
        React.createElement('span', { key: 'd', className: 'dot' }), 'FinSight',
      ]),
      showTabs ? React.createElement('div', { key: 'n', className: 'navtabs' }, [
        React.createElement('button', { key: 't', className: 'navtab' + (screen === 'table' ? ' active' : ''), onClick: () => onNav('table') }, '분류 결과'),
        React.createElement('button', { key: 'q', className: 'navtab' + (screen === 'qa' ? ' active' : ''), onClick: () => onNav('qa') },
          [plan === 'free' ? React.createElement(Icon, { key: 'i', name: 'lock' }) : null, 'Q&A']),
      ]) : React.createElement('div', { key: 'n' }),
      React.createElement('div', { key: 'p', className: 'plan-chip' },
        plan === 'pro' ? React.createElement('b', null, 'PRO 요금제') : [React.createElement('span', { key: 's' }, '무료 요금제'), React.createElement('a', { key: 'u', href: '#', onClick: (e) => { e.preventDefault(); onNav('upgrade'); } }, 'Pro로 업그레이드')]),
    ]));
}

function Disclaimer() {
  return React.createElement('div', { className: 'disclaimer' },
    React.createElement('div', { className: 'container' }, [
      React.createElement(Icon, { key: 'i', name: 'info' }),
      '이 결과는 세무 조언이 아닙니다. 최종 판단은 세무 대리인과 상의하세요.',
    ]));
}

function Landing({ onDrop }) {
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  useIcons([]);
  return React.createElement('div', null, [
    React.createElement('div', { key: 'h', className: 'appbar' },
      React.createElement('div', { className: 'container' }, [
        React.createElement('div', { key: 'w', className: 'wordmark' }, [React.createElement('span', { key: 'd', className: 'dot' }), 'FinSight']),
        React.createElement('div', { key: 's' }),
        React.createElement('a', { key: 'l', href: '#', onClick: (e) => e.preventDefault(), style: { fontSize: 14, fontWeight: 600 } }, '로그인'),
      ])),
    React.createElement('div', { key: 'b', className: 'container' }, [
      React.createElement('div', { key: 'hero', className: 'hero' }, [
        React.createElement('h1', { key: 'h1' }, '카드 명세서 하나로, 사업경비와 개인지출을 가릅니다'),
        React.createElement('p', { key: 'p', className: 'sub' }, 'AI가 거래별로 사업경비와 개인지출을 분류하고 계정과목까지 매핑합니다. 신고철마다 명세서를 뒤지는 수작업을 없애세요.'),
        React.createElement('div', {
          key: 'dz', className: 'dropzone' + (drag ? ' drag' : ''),
          onClick: () => fileRef.current.click(),
          onDragOver: (e) => { e.preventDefault(); setDrag(true); },
          onDragLeave: () => setDrag(false),
          onDrop: (e) => { e.preventDefault(); setDrag(false); onDrop(); },
        }, [
          React.createElement(Icon, { key: 'i', name: 'upload-cloud' }),
          React.createElement('h3', { key: 'h3' }, '카드 명세서를 드래그하거나 파일을 선택하세요'),
          React.createElement('p', { key: 'p2' }, 'CSV, XLSX · 최대 10,000행'),
          React.createElement(Button, { key: 'btn', onClick: (e) => { e.stopPropagation(); onDrop(); } }, '파일 선택'),
          React.createElement('input', { key: 'in', ref: fileRef, type: 'file', accept: '.csv,.xlsx', style: { display: 'none' }, onChange: onDrop }),
        ]),
        React.createElement('div', { key: 'pr', className: 'privacy-row' }, [
          React.createElement('span', { key: '1' }, [React.createElement(Icon, { key: 'i', name: 'shield-check' }), '카드번호 저장 안 함']),
          React.createElement('span', { key: '2' }, [React.createElement(Icon, { key: 'i', name: 'lock' }), '원본 파일 서버 전송 안 함']),
        ]),
      ]),
      React.createElement('div', { key: 'fg', className: 'feature-grid' }, [
        React.createElement(FeatureCard, { key: '1', title: '자동 컬럼 매핑', body: '카드사마다 다른 헤더를 휴리스틱으로 추측해 날짜·가맹점·금액에 매핑합니다.' }),
        React.createElement(FeatureCard, { key: '2', title: 'AI 거래 분류', body: '거래별로 사업경비·개인지출을 분류하고 확신도가 낮은 건은 상단에 노출합니다.' }),
        React.createElement(FeatureCard, { key: '3', title: '규칙 학습', body: '수정한 분류를 규칙으로 저장해 다음 달 AI 호출 전에 선적용합니다.' }),
      ]),
    ]),
  ]);
}

function Parsing() {
  useIcons([]);
  return React.createElement('div', { className: 'connect-wrap' },
    React.createElement('div', null, [
      React.createElement('div', { key: 's', className: 'spinner' }),
      React.createElement('p', { key: 'p', style: { color: 'var(--color-muted)', fontSize: 14 } }, '파일을 분석하는 중입니다…'),
    ]));
}

function Mapping({ onNext }) {
  const headers = ['거래일자', '이용가맹점명', '결제금액', '승인번호', '할부여부', '포인트적립'];
  const [map, setMap] = useState({ date: '거래일자', merchant: '이용가맹점명', amount: '결제금액' });
  const first = DATA.transactions[0];
  const preview = { date: first.date, merchant: first.merchant, amount: won(first.amount) };
  useIcons([]);
  return React.createElement('div', { className: 'container', style: { paddingBottom: 96 } }, [
    React.createElement('div', { key: 'st', className: 'steps' }, [
      React.createElement('div', { key: '1', className: 'step' }, [React.createElement('span', { key: 'n', className: 'num' }, [React.createElement(Icon, { key: 'i', name: 'check', style: { width: 12, height: 12 } })]), '업로드']),
      React.createElement('div', { key: '2', className: 'step active' }, [React.createElement('span', { key: 'n', className: 'num' }, '2'), '컬럼 확인']),
      React.createElement('div', { key: '3', className: 'step' }, [React.createElement('span', { key: 'n', className: 'num' }, '3'), '분석']),
    ]),
    React.createElement('div', { key: 'c', className: 'card', style: { maxWidth: 720 } }, [
      React.createElement('h2', { key: 'h' }, DATA.filename),
      React.createElement('p', { key: 'p', style: { fontSize: 13, color: 'var(--color-muted)', margin: '0 0 var(--space-lg)' } }, '인코딩 감지: ' + DATA.detectedEncoding + ' · ' + DATA.totalRows + '행'),
      ['date', 'merchant', 'amount'].map((k) =>
        React.createElement('div', { key: k, className: 'map-row' }, [
          React.createElement('div', { key: 'l', className: 'map-label' }, k === 'date' ? '날짜' : k === 'merchant' ? '가맹점' : '금액'),
          React.createElement('select', {
            key: 's', className: 'map-select', value: map[k],
            onChange: (e) => setMap({ ...map, [k]: e.target.value }),
          }, headers.map((h) => React.createElement('option', { key: h, value: h }, h))),
          React.createElement('div', { key: 'pv', className: 'map-preview' }, '예: ' + preview[k]),
        ])),
      React.createElement('div', { key: 'btn', style: { marginTop: 24, textAlign: 'right' } },
        React.createElement(Button, { onClick: onNext }, '분석 시작')),
    ]),
  ]);
}

function Preview({ onConnect, plan }) {
  useIcons([]);
  const sample = DATA.transactions.slice(0, SAMPLE_COUNT);
  const total = DATA.transactions.reduce((s, t) => s + t.amount, 0);
  const merchantSums = {};
  DATA.transactions.forEach((t) => { merchantSums[t.merchant] = (merchantSums[t.merchant] || 0) + t.amount; });
  const top = Object.entries(merchantSums).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const weeks = [[2, 8], [9, 15], [16, 22]];
  const weekSums = weeks.map(([lo, hi]) => DATA.transactions.filter((t) => { const d = parseInt(t.date.slice(3)); return d >= lo && d <= hi; }).reduce((s, t) => s + t.amount, 0));
  const maxWeek = Math.max(...weekSums);
  return React.createElement('div', { className: 'container', style: { paddingBottom: 96, paddingTop: 32 } }, [
    React.createElement('div', { key: 'st', className: 'steps' }, [
      React.createElement('div', { key: '1', className: 'step' }, [React.createElement('span', { key: 'n', className: 'num' }, [React.createElement(Icon, { key: 'i', name: 'check', style: { width: 12, height: 12 } })]), '업로드']),
      React.createElement('div', { key: '2', className: 'step' }, [React.createElement('span', { key: 'n', className: 'num' }, [React.createElement(Icon, { key: 'i', name: 'check', style: { width: 12, height: 12 } })]), '컬럼 확인']),
      React.createElement('div', { key: '3', className: 'step active' }, [React.createElement('span', { key: 'n', className: 'num' }, '3'), '분석']),
    ]),
    React.createElement('div', { key: 'sg', className: 'summary-grid' }, [
      React.createElement('div', { key: '1', className: 'stat-card' }, [
        React.createElement('div', { key: 'l', className: 'label' }, '7월 총 지출'),
        React.createElement('div', { key: 'v', className: 'value' }, won(total)),
        React.createElement('div', { key: 'b', className: 'bars' }, weekSums.map((w, i) => React.createElement('div', { key: i, className: 'bar', style: { height: (w / maxWeek * 100) + '%' } }))),
      ]),
      React.createElement('div', { key: '2', className: 'stat-card' }, [
        React.createElement('div', { key: 'l', className: 'label' }, '총 거래 건수'),
        React.createElement('div', { key: 'v', className: 'value' }, DATA.totalRows + '건'),
      ]),
      React.createElement('div', { key: '3', className: 'stat-card' }, [
        React.createElement('div', { key: 'l', className: 'label' }, '상위 가맹점'),
        React.createElement('ul', { key: 'ul', className: 'merchant-list' }, top.map(([m, s]) => React.createElement('li', { key: m }, [React.createElement('span', { key: 'm' }, m), React.createElement('b', { key: 's' }, won(s))]))),
      ]),
    ]),
    React.createElement('p', { key: 'st2', className: 'section-title' }, '표본 분류 · ' + SAMPLE_COUNT + '건'),
    React.createElement('table', { key: 'tb', className: 'tx' }, [
      React.createElement('thead', { key: 'h' }, React.createElement('tr', null, ['날짜', '가맹점', '금액', '분류', '확신도'].map((h) => React.createElement('th', { key: h, className: h === '금액' ? 'num' : '' }, h)))),
      React.createElement('tbody', { key: 'b' }, sample.map((t) => React.createElement('tr', { key: t.id, className: t.category === '확인필요' ? 'needs-review' : '' }, [
        React.createElement('td', { key: 'd' }, t.date),
        React.createElement('td', { key: 'm' }, t.merchant),
        React.createElement('td', { key: 'a', className: 'num' }, won(t.amount)),
        React.createElement('td', { key: 'c' }, React.createElement(StatusTag, { category: t.category })),
        React.createElement('td', { key: 'f', className: 'confidence' }, t.confidence + '%'),
      ]))),
    ]),
    React.createElement('div', { key: 'lb', className: 'lock-banner' }, [
      React.createElement(Icon, { key: 'i', name: 'lock' }),
      React.createElement('div', { key: 't' }, [
        React.createElement('h4', { key: 'h' }, '나머지 ' + (DATA.totalRows - SAMPLE_COUNT) + '건은 아직 분류되지 않았습니다'),
        React.createElement('p', { key: 'p' }, '계정을 연결하면 전체 ' + DATA.totalRows + '건을 분류합니다. 결과는 계속 유지됩니다.'),
      ]),
      React.createElement('div', { key: 'sp', className: 'spacer' }),
      React.createElement(Button, { key: 'btn', onClick: onConnect }, 'Google 계정 연결'),
    ]),
  ]);
}

function Connect({ onDone }) {
  const [loading, setLoading] = useState(false);
  useIcons([loading]);
  if (loading) return React.createElement(Parsing, null);
  return React.createElement('div', { className: 'connect-wrap' },
    React.createElement('div', { className: 'gcard' }, [
      React.createElement('div', { key: 'c', className: 'gcircle' }, 'G'),
      React.createElement('h3', { key: 'h' }, 'Google 계정으로 계속하기'),
      React.createElement('p', { key: 'm', className: 'mail' }, 'freelancer.kim@gmail.com'),
      React.createElement('ul', { key: 'l', className: 'consent-list' }, [
        ['user', '이름 및 프로필 정보'], ['mail', '이메일 주소'],
      ].map(([icon, label]) => React.createElement('li', { key: label }, [React.createElement(Icon, { key: 'i', name: icon }), label]))),
      React.createElement(Button, { key: 'b', size: 'large', onClick: () => { setLoading(true); setTimeout(onDone, 1400); } }, '동의하고 계속'),
    ]));
}

function TableScreen({ rows, setRows, plan, onUpgrade, showToast }) {
  useIcons([rows]);
  const sorted = [...rows].sort((a, b) => (a.category === '확인필요' ? -1 : 0) - (b.category === '확인필요' ? -1 : 0));
  const cycle = (row) => {
    const cat = nextCategory(row.category);
    const acct = cat === '사업경비' ? (row.account || '기타') : null;
    setRows(rows.map((r) => (r.merchant === row.merchant ? { ...r, category: cat, account: acct } : r)));
    showToast("규칙 저장 · '" + row.merchant + "' → " + cat + '로 앞으로 자동 분류됩니다');
  };
  const setAccount = (row, acct) => setRows(rows.map((r) => (r.id === row.id ? { ...r, account: acct } : r)));
  const needsReview = rows.filter((r) => r.category === '확인필요').length;
  return React.createElement('div', { className: 'container', style: { paddingTop: 24, paddingBottom: 96 } }, [
    React.createElement('div', { key: 'tb', className: 'table-toolbar' }, [
      React.createElement('div', { key: 'u', className: 'usage-note' }, [
        plan === 'free' ? React.createElement('span', { key: 'note' }, ['무료 요금제 · 이번 달 전건 분류 ', React.createElement('b', { key: 'b' }, '1/1'), '회 사용 · 확인 필요 ', React.createElement('b', { key: 'b2' }, needsReview), '건']) : React.createElement('span', { key: 'note' }, ['PRO 요금제 · 확인 필요 ', React.createElement('b', { key: 'b' }, needsReview), '건']),
      ]),
      React.createElement('div', { key: 'a', style: { display: 'flex', gap: 10 } }, [
        React.createElement(Button, { key: 'csv', variant: 'secondary-light', onClick: () => (plan === 'pro' ? showToast('CSV로 내보냈습니다') : onUpgrade()) }, [plan === 'free' ? React.createElement(Icon, { key: 'i', name: 'lock' }) : null, ' CSV 내보내기']),
        React.createElement(Button, { key: 'print', variant: 'secondary-light', onClick: () => (plan === 'pro' ? window.print() : onUpgrade()) }, [plan === 'free' ? React.createElement(Icon, { key: 'i', name: 'lock' }) : null, ' 인쇄']),
      ]),
    ]),
    React.createElement('table', { key: 't', className: 'tx' }, [
      React.createElement('thead', { key: 'h' }, React.createElement('tr', null, ['날짜', '가맹점', '금액', '분류', '계정과목', '확신도'].map((h) => React.createElement('th', { key: h, className: h === '금액' ? 'num' : '' }, h)))),
      React.createElement('tbody', { key: 'b' }, sorted.map((r) => React.createElement('tr', { key: r.id, className: r.category === '확인필요' ? 'needs-review' : '' }, [
        React.createElement('td', { key: 'd' }, r.date),
        React.createElement('td', { key: 'm' }, r.merchant),
        React.createElement('td', { key: 'a', className: 'num' }, won(r.amount)),
        React.createElement('td', { key: 'c' }, React.createElement(StatusTag, { category: r.category, onClick: () => cycle(r) })),
        React.createElement('td', { key: 'acc' }, r.category === '사업경비'
          ? React.createElement('select', { className: 'acct', value: r.account || '기타', onChange: (e) => setAccount(r, e.target.value) }, ACCOUNTS.map((a) => React.createElement('option', { key: a, value: a }, a)))
          : React.createElement('span', { style: { color: 'var(--color-muted-soft)' } }, '—')),
        React.createElement('td', { key: 'f', className: 'confidence' }, r.confidence + '%'),
      ]))),
    ]),
  ]);
}

function QAScreen({ plan, onUpgrade, rows }) {
  const [messages, setMessages] = useState([{ role: 'ai', text: '안녕하세요. 업로드하신 32건의 거래에 대해 물어보세요.' }]);
  const [input, setInput] = useState('');
  useIcons([plan, messages]);
  if (plan === 'free') {
    return React.createElement('div', { className: 'container' },
      React.createElement('div', { className: 'qa-lock' }, [
        React.createElement(Icon, { key: 'i', name: 'lock' }),
        React.createElement('h3', { key: 'h' }, '대화형 Q&A는 Pro 전용입니다'),
        React.createElement('p', { key: 'p' }, '"지난 분기 접대비 얼마 썼어?"처럼 자연어로 물어보고 즉시 답을 받으세요.'),
        React.createElement('div', { key: 'pr', className: 'pricing-row' }, [
          React.createElement(PricingTierCard, { key: 'f', name: 'Free', price: '₩0', period: '/월', features: ['업로드·집계 프리뷰 무제한', '전건 경비 분류 월 1회', '사용자 규칙 학습', '히스토리 전체 열람'], cta: '현재 요금제' }),
          React.createElement('div', { key: 'p', style: { cursor: 'pointer' }, onClick: onUpgrade }, React.createElement(PricingTierCard, { featured: true, name: 'Pro', price: '₩19,000', period: '/월', features: ['전건 경비 분류 월 10회', '대화형 Q&A 월 100건', 'CSV 내보내기 · 인쇄', '히스토리 전체 열람'], cta: '업그레이드' })),
        ]),
      ]));
  }
  const answer = (q) => {
    const lower = q;
    if (lower.includes('접대비')) {
      const s = rows.filter((r) => r.account === '접대비').reduce((a, r) => a + r.amount, 0);
      return '7월 접대비 지출은 ' + won(s) + '입니다.';
    }
    if (lower.includes('확인') || lower.includes('검토')) {
      const c = rows.filter((r) => r.category === '확인필요').length;
      return '확인이 필요한 거래는 ' + c + '건입니다.';
    }
    if (lower.includes('사업경비') || lower.includes('경비')) {
      const s = rows.filter((r) => r.category === '사업경비').reduce((a, r) => a + r.amount, 0);
      return '7월 사업경비 총액은 ' + won(s) + '입니다.';
    }
    if (lower.includes('개인')) {
      const s = rows.filter((r) => r.category === '개인지출').reduce((a, r) => a + r.amount, 0);
      return '7월 개인지출 총액은 ' + won(s) + '입니다.';
    }
    return '해당 질문에 대한 데이터를 찾지 못했습니다. 계정과목이나 기간을 포함해 다시 물어보세요.';
  };
  const send = (text) => {
    const q = (text || input).trim();
    if (!q) return;
    setMessages((m) => [...m, { role: 'user', text: q }, { role: 'ai', text: answer(q) }]);
    setInput('');
  };
  const quick = ['사업경비 총액은?', '접대비 얼마 썼어?', '확인 필요한 거래가 몇 건이야?'];
  return React.createElement('div', { className: 'container' }, [
    React.createElement('div', { key: 'c', className: 'chat-wrap' }, [
      messages.map((m, i) => React.createElement('div', { key: i, className: 'msg ' + m.role }, React.createElement('div', { className: 'bubble' }, m.text))),
      React.createElement('div', { key: 'qc', className: 'quick-chips' }, quick.map((q) => React.createElement('button', { key: q, className: 'quick-chip', onClick: () => send(q) }, q))),
    ]),
    React.createElement('div', { key: 'bar', className: 'chat-input-bar' },
      React.createElement('div', { className: 'chat-input' }, [
        React.createElement('input', { key: 'i', placeholder: '질문을 입력하세요…', value: input, onChange: (e) => setInput(e.target.value), onKeyDown: (e) => e.key === 'Enter' && send() }),
        React.createElement('button', { key: 'b', onClick: () => send() }, React.createElement(Icon, { name: 'send' })),
      ])),
  ]);
}

function UpgradeModal({ onClose, onUpgrade }) {
  useIcons([]);
  return React.createElement('div', { className: 'modal-overlay', onClick: onClose },
    React.createElement('div', { className: 'modal-card', onClick: (e) => e.stopPropagation() }, [
      React.createElement('button', { key: 'x', className: 'modal-close', onClick: onClose }, React.createElement(Icon, { name: 'x' })),
      React.createElement('h2', { key: 'h', style: { textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-display)' } }, 'Pro로 업그레이드'),
      React.createElement('p', { key: 'p', style: { textAlign: 'center', color: 'var(--color-muted)', margin: 'var(--space-xs) 0 0' } }, '분석 1회(300건 기준) 원가 약 440원 · 예측 가능한 횟수제'),
      React.createElement('div', { key: 'pr', className: 'pricing-row' }, [
        React.createElement(PricingTierCard, { key: 'f', name: 'Free', price: '₩0', period: '/월', features: ['업로드·집계 프리뷰 무제한', '전건 경비 분류 월 1회', '사용자 규칙 학습'], cta: '현재 요금제' }),
        React.createElement('div', { key: 'p', style: { cursor: 'pointer' }, onClick: onUpgrade }, React.createElement(PricingTierCard, { featured: true, name: 'Pro', price: '₩19,000', period: '/월', features: ['전건 경비 분류 월 10회', '대화형 Q&A 월 100건', 'CSV 내보내기 · 인쇄'], cta: '지금 업그레이드' })),
      ]),
    ]));
}

function App() {
  const [screen, setScreen] = useState('landing');
  const [plan, setPlan] = useState('free');
  const [rows, setRows] = useState(DATA.transactions.map((t) => ({ ...t })));
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(false);
  const showToast = (msg) => { setToast(msg); clearTimeout(window.__ft); window.__ft = setTimeout(() => setToast(null), 2600); };
  const handleUpload = () => { setScreen('parsing'); setTimeout(() => setScreen('mapping'), 900); };
  const handleAnalyze = () => { setScreen('parsing'); setTimeout(() => setScreen('preview'), 900); };
  const handleNav = (dest) => { if (dest === 'upgrade') setModal(true); else setScreen(dest); };

  let body;
  if (screen === 'landing') body = React.createElement(Landing, { onDrop: handleUpload });
  else if (screen === 'parsing') body = React.createElement(Parsing, null);
  else if (screen === 'mapping') body = React.createElement(Mapping, { onNext: handleAnalyze });
  else if (screen === 'preview') body = React.createElement(Preview, { onConnect: () => setScreen('connect'), plan });
  else if (screen === 'connect') body = React.createElement(Connect, { onDone: () => { setScreen('table'); showToast('Google 계정을 연결했습니다 · 전체 ' + DATA.totalRows + '건을 분류했습니다'); } });
  else if (screen === 'table') body = React.createElement(TableScreen, { rows, setRows, plan, onUpgrade: () => setModal(true), showToast });
  else if (screen === 'qa') body = React.createElement(QAScreen, { plan, onUpgrade: () => setModal(true), rows });

  const showHeader = screen !== 'landing' && screen !== 'connect' && screen !== 'parsing';
  return React.createElement('div', null, [
    showHeader ? React.createElement(Header, { key: 'h', screen, plan, onNav: handleNav, onReset: () => setScreen('landing') }) : null,
    showHeader && (screen === 'table' || screen === 'qa') ? React.createElement(Disclaimer, { key: 'd' }) : null,
    React.createElement('div', { key: 'b' }, body),
    toast ? React.createElement('div', { key: 't', className: 'toast' }, [React.createElement(Icon, { key: 'i', name: 'check-circle-2' }), toast]) : null,
    modal ? React.createElement(UpgradeModal, { key: 'm', onClose: () => setModal(false), onUpgrade: () => { setPlan('pro'); setModal(false); showToast('Pro로 업그레이드 되었습니다'); } }) : null,
  ]);
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
