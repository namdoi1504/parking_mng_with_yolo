/* Local review prototype. No authentication, network calls or persistent writes. */
const icons = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  car: '<path d="m5 10 2-5h10l2 5M4 10h16v8H4zM6 18v2m12-2v2M7 13h1m8 0h1"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 4v3"/>',
  alert: '<path d="m12 3 10 18H2L12 3zM12 9v5m0 3v.2"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5zm6-2v16m6-14v16"/>',
  camera: '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 10 6-4v12l-6-4M5 3l14 18"/>',
  chart: '<path d="M4 3v18h17M9 16v-5m5 5V6m5 10V9"/>',
  users: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5"/>',
  shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4z"/><path d="m8 12 3 3 5-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
  pin: '<path d="M19 10c0 5-7 12-7 12S5 15 5 10a7 7 0 0 1 14 0z"/><circle cx="12" cy="10" r="2"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.info}</svg>`;
const status = {
  empty:{label:'Trống',icon:'check'},occupied:{label:'Có xe',icon:'car'},
  reserved:{label:'Đã giữ',icon:'lock'},unknown:{label:'Chưa rõ',icon:'alert'}
};
const initial = ['occupied','empty','occupied','reserved','empty','occupied','empty','occupied','empty','occupied','reserved','empty','occupied','empty','unknown','occupied','empty','reserved','empty','occupied','empty','occupied','empty','occupied'];
const slots = initial.map((state,i)=>({id:`${i<12?'A':'B'}-${String(i%12+1).padStart(2,'0')}`,zone:i<12?'A':'B',state}));
const app = document.getElementById('app');
const requestedView=new URLSearchParams(window.location.search).get('view');
let view=['driver','operator','login'].includes(requestedView)?requestedView:'driver',zone='all',query='',filter='all',selected='A-02',toastTimer,pendingAction=null;
const brand = () => '<div class="brand"><span class="brand-mark" aria-hidden="true">P</span><div>ImperiaSmart<small>PARKING MANAGEMENT</small></div></div>';
const counts = () => Object.fromEntries(Object.keys(status).map(key=>[key,slots.filter(s=>s.state===key).length]));
const pill = (state) => `<span class="status-pill ${state}">${icon(status[state].icon)}${status[state].label}</span>`;
const legend = () => `<div class="legend" aria-label="Chú giải trạng thái">${Object.entries(status).map(([key,value])=>`<span class="${key}"><i aria-hidden="true"></i>${value.label}</span>`).join('')}</div>`;
function visible(s){return (zone==='all'||s.zone===zone)&&(!query||s.id.toLowerCase().includes(query.toLowerCase()))&&(filter==='all'||s.state===filter)}
function mapPanel(){
  const operator=view==='operator';
  return `<section class="map-panel" aria-label="Sơ đồ minh họa 24 ô đỗ">
    <div class="map-toolbar"><div class="filter-row">
      <div class="segments" aria-label="Lọc khu đỗ">${[['all','Tất cả'],['A','Khu A'],['B','Khu B']].map(([value,label])=>`<button data-zone="${value}" aria-pressed="${zone===value}">${label}</button>`).join('')}</div>
      ${operator?`<label class="search-box">${icon('search')}<select id="status-filter" aria-label="Lọc trạng thái ô đỗ"><option value="all" ${filter==='all'?'selected':''}>Mọi trạng thái</option>${Object.entries(status).map(([key,val])=>`<option value="${key}" ${filter===key?'selected':''}>${val.label}</option>`).join('')}</select></label>`:`<label class="search-box">${icon('search')}<input id="slot-search" placeholder="Tìm mã ô, ví dụ A-02" value="" aria-label="Tìm theo mã ô đỗ" autocomplete="off"></label>`}
    </div><div class="map-caption"><strong>Sơ đồ bãi đỗ</strong>${legend()}</div></div>
    <div class="parking-surface"><div class="map-topline"><span>Sơ đồ minh họa · 24 ô</span><span class="entrance">${icon('arrow')}Lối vào</span></div>
    ${['A','B'].filter(z=>zone==='all'||zone===z).map(z=>`<div class="zone-heading">KHU ${z} <span>· ${slots.filter(s=>s.zone===z&&s.state==='empty').length} ô trống</span></div>${[0,1].map(row=>`${row?'<div class="driveway">LỐI DI CHUYỂN →</div>':''}<div class="slot-row">${slots.filter(s=>s.zone===z).slice(row*6,row*6+6).map(s=>`<button class="slot ${s.state}${visible(s)?'':' filtered'}" data-slot="${s.id}" aria-label="Ô ${s.id}, ${status[s.state].label}${visible(s)?'':', ngoài bộ lọc'}" aria-pressed="${selected===s.id}">${icon(status[s.state].icon)}<strong>${s.id}</strong><small>${status[s.state].label}</small></button>`).join('')}</div>`).join('')}`).join('')}
    ${slots.some(visible)?'':'<p class="empty-results" role="status">Không có ô phù hợp. Thử đổi khu hoặc bỏ bộ lọc.</p>'}
    <div class="map-bottom"><span>${icon('pin')}ImperiaSmart · bãi đỗ mẫu</span><span>Không dùng sơ đồ này để dẫn đường thực tế</span></div></div>
    <div class="map-footer">${operator?'Chọn ô để xem trạng thái và thử thao tác giữ chỗ.':'Chọn ô để xem chi tiết. Ô ngoài bộ lọc được làm mờ.'} Số liệu chỉ dùng để duyệt thiết kế.</div>
  </section>`;
}
function detail(){
  const s=slots.find(x=>x.id===selected), operator=view==='operator';
  const action = operator ? (s.state==='empty'?`<button class="button primary full" data-action="reserve">${icon('lock')}Giữ chỗ này</button>`:s.state==='reserved'?`<button class="button primary full" data-action="confirm">${icon('car')}Xác nhận xe đã vào</button><button class="button danger full" data-action="cancel">Hủy giữ chỗ</button>`:s.state==='unknown'?`<button class="button dark full" data-action="camera">${icon('camera')}Kiểm tra camera phụ trách</button>`:'') : s.state==='empty'?`<button class="button full" data-action="next">Xem ô trống tiếp theo ${icon('arrow')}</button>`:`<button class="button primary full" data-action="find">${icon('search')}Tìm một ô trống</button>`;
  const note = operator ? s.state==='unknown'?'Chưa có dữ liệu xác nhận trạng thái. Kiểm tra nguồn camera trước khi hướng dẫn xe vào.':s.state==='reserved'?'Hai thao tác được tách rõ: xác nhận xe vào hoặc hủy giữ chỗ. Mẫu chỉ thay đổi dữ liệu trên trang này.':'Thao tác xuất hiện theo trạng thái ô. Khi áp dụng, chỉ Administrator được giữ chỗ theo API hiện tại.' : s.state==='empty'?'Trạng thái có thể thay đổi khi xe khác vào. Cần xác nhận tại bãi trước khi đỗ.':'Ô này chưa phù hợp để đỗ. Chọn “Tìm một ô trống” để xem lựa chọn khác.';
  return `<aside class="detail-panel" aria-label="Chi tiết ô đang chọn" tabindex="-1"><div class="detail-kicker">${operator?'THAO TÁC TRÊN Ô':'Ô ĐANG CHỌN'}</div><h2 class="slot-title">${s.id}</h2>${pill(s.state)}
  <dl class="detail-list"><div><dt>Khu vực</dt><dd>Khu ${s.zone}</dd></div><div><dt>Loại chỗ đỗ</dt><dd>Ô tô</dd></div>${operator?`<div><dt>Camera phụ trách</dt><dd>CAM-${s.zone==='A'?'01':'02'}</dd></div>`:''}<div><dt>Nguồn trạng thái</dt><dd>Dữ liệu mẫu</dd></div></dl>
  <div class="detail-actions">${action}<button class="button mobile-map-link" data-action="map">${icon('map')}Quay lại sơ đồ</button></div><p class="detail-note">${note}</p></aside>`;
}
function driver(){
  const c=counts();
  return `<header class="public-header">${brand()}<button class="button" data-view="login">Nhân viên đăng nhập ${icon('arrow')}</button></header>
  <main id="main" class="public-main" tabindex="-1"><div class="page-intro"><div><div class="eyebrow">TRA CỨU CHỖ ĐỖ</div><h1>Tìm chỗ đỗ, nhẹ một việc.</h1><p>Chọn khu và xem ô trống trước khi vào bãi.</p></div><div class="capacity"><div class="capacity-number">${c.empty}</div><span><strong>ô đang trống</strong>trong 24 ô mẫu</span><button class="button primary" data-action="find">${icon('search')}Tìm ô trống</button></div></div>
  <div class="workspace">${mapPanel()}<div>${detail()}<div class="public-hint">${icon('info')}<div><strong>Xem chỗ đỗ không cần tài khoản</strong>Giao diện dành cho người lái ưu tiên tra cứu. Các chức năng điều hành nằm trong khu vực nhân viên.</div></div></div></div></main>`;
}
function operator(){
  const c=counts();
  return `<div class="op-layout"><aside class="sidebar" aria-label="Điều hướng mẫu">${brand()}<div class="nav-caption">VẬN HÀNH</div><nav class="side-nav"><button class="active" aria-current="page">${icon('map')}Điều hành bãi đỗ</button><button disabled>${icon('chart')}Thống kê</button></nav><div class="nav-caption">QUẢN TRỊ</div><nav class="side-nav"><button disabled>${icon('users')}Người dùng & camera</button><button disabled>${icon('shield')}Phân quyền</button></nav><p class="side-note">Mẫu tập trung vào màn hình điều hành. Menu còn lại mô tả cách nhóm chức năng.</p><div class="sidebar-bottom"><span class="avatar">NV</span><div><strong>Quản trị viên bãi đỗ</strong><small>Administrator · mẫu</small></div></div></aside>
  <main id="main" class="op-main" tabindex="-1"><div class="op-topline"><span>ImperiaSmart / Vận hành</span><span>Bản mẫu · không có dữ liệu trực tiếp</span></div><div class="page-intro"><div><h1>Điều hành bãi đỗ</h1><p>Trạng thái bãi xe và thao tác tại một nơi.</p></div><button class="button" data-action="reset">${icon('refresh')}Đặt lại mẫu</button></div>
  <section class="metrics" aria-label="Tổng quan dữ liệu mẫu"><div class="metric"><div class="metric-label">${icon('check')}Đang trống</div><div class="metric-value">${c.empty}<small>/ 24 ô</small></div><div class="metric-foot">Có thể hướng dẫn xe vào</div></div><div class="metric"><div class="metric-label">${icon('car')}Đang có xe</div><div class="metric-value">${c.occupied}</div><div class="metric-foot">${Math.round(c.occupied/24*100)}% tổng số ô</div></div><div class="metric"><div class="metric-label">${icon('lock')}Đã giữ chỗ</div><div class="metric-value">${c.reserved}</div><div class="metric-foot">Chờ xác nhận xe vào</div></div><div class="metric"><div class="metric-label">${icon('alert')}Cần kiểm tra</div><div class="metric-value">${c.unknown}</div><div class="metric-foot">Trạng thái chưa xác định</div></div></section>
  <div class="alert-strip"><div class="row">${icon('alert')}<span><strong>Ô B-03 chưa rõ trạng thái.</strong> Kiểm tra nguồn hình trước khi cho xe vào.</span></div><button data-action="unknown">Xem ô ${icon('arrow')}</button></div>
  <div class="workspace"><div>${mapPanel()}<section class="camera-panel" id="camera"><div class="camera-head"><strong>${icon('camera')} Camera phụ trách · CAM-${selected.startsWith('A')?'01':'02'}</strong><span class="muted">Trạng thái mẫu</span></div><div class="camera-state">${icon('camera')}<div><strong>Chưa có hình để xác nhận</strong><p>Hiển thị rõ nguồn hình, lần cập nhật gần nhất và hướng xử lý khi áp dụng.</p></div><button class="button" data-action="reconnect">${icon('refresh')}Thử nối lại</button></div></section></div>${detail()}</div></main></div>`;
}
function login(){
  return `<main id="main" class="login-wrap" tabindex="-1"><div class="login-layout"><section class="login-story">${brand()}<div class="login-story-copy"><div class="eyebrow">IMPERIASMART PARKING</div><h1>Một góc nhìn rõ ràng.<br>Một bãi xe dễ vận hành.</h1><p>Theo dõi chỗ đỗ và xử lý từng tình huống trong một không gian làm việc gọn gàng.</p></div><img class="login-art" src="assets/parking-courtyard.png" alt="Minh họa một bãi đỗ thoáng với ô tô, cây xanh, thanh chắn và camera" width="1536" height="1024"><div class="illustration-caption">${icon('info')}Minh họa ý tưởng · không phải ảnh hoặc sơ đồ bãi thực tế</div></section>
  <section class="login-form-panel"><div class="eyebrow">KHÔNG GIAN NHÂN VIÊN</div><h2>Chào mừng trở lại.</h2><p>Đăng nhập để bắt đầu ca làm việc.</p><div class="form-field"><label for="preview-account">Tài khoản</label><input id="preview-account" value="Tài khoản của bạn" disabled></div><div class="form-field"><label for="preview-password">Mật khẩu</label><input id="preview-password" type="password" value="sampleonly" disabled></div><div class="form-meta">${icon('lock')}Mẫu không thu thập tài khoản hoặc mật khẩu.</div><button class="button primary full" data-view="operator">Xem mẫu sau đăng nhập ${icon('arrow')}</button><div class="separator">hoặc</div><button class="button full" data-view="driver">${icon('search')}Tra cứu chỗ đỗ không cần đăng nhập</button><p class="login-foot"><strong>Ảnh tạo riêng cho phong cách này.</strong><br>Navy trầm, xanh lá tiết chế và nền sáng để giao diện gần gũi hơn.</p></section></div></main>`;
}
function render(){
  app.innerHTML = view==='driver'?driver():view==='operator'?operator():login();
  document.querySelectorAll('.view-switch [data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
  const search=document.getElementById('slot-search');if(search)search.value=query;
}
function notify(message){clearTimeout(toastTimer);const box=document.getElementById('toast');box.textContent=message;box.classList.add('visible');toastTimer=setTimeout(()=>box.classList.remove('visible'),6500)}
function switchView(next){clearTimeout(toastTimer);document.getElementById('toast').classList.remove('visible');view=next;zone='all';query='';filter='all';render();window.scrollTo({top:0,behavior:'instant'});document.getElementById('main').focus({preventScroll:true})}
function findFree(next=false){const available=slots.filter(s=>s.state==='empty'&&(zone==='all'||zone===s.zone));const index=available.findIndex(s=>s.id===selected);const s=available[next?(index+1)%available.length:0];if(!s){notify('Khu đang chọn chưa có ô trống. Hãy chọn khu khác.');return}selected=s.id;query='';filter='all';render();notify(`Đã chọn ô ${s.id} trong sơ đồ mẫu. Đây chưa phải đặt hoặc giữ chỗ.`);document.querySelector(`[data-slot="${s.id}"]`)?.focus({preventScroll:true})}
document.addEventListener('click',e=>{
  const button=e.target.closest('button');if(!button||button.disabled)return;
  if(button.dataset.view){switchView(button.dataset.view);return}
  if(button.dataset.zone){zone=button.dataset.zone;if(zone!=='all'&&!selected.startsWith(zone)){selected=(slots.find(s=>s.zone===zone&&s.state==='empty')||slots.find(s=>s.zone===zone)).id}render();document.querySelector(`[data-zone="${zone}"]`).focus({preventScroll:true});return}
  if(button.dataset.slot){selected=button.dataset.slot;render();if(innerWidth<=680){const panel=document.querySelector('.detail-panel');panel.scrollIntoView({behavior:'instant',block:'start'});panel.focus({preventScroll:true})}else{document.querySelector(`[data-slot="${selected}"]`).focus({preventScroll:true})}return}
  const action=button.dataset.action,s=slots.find(s=>s.id===selected);
  if(action==='dismiss'){document.getElementById('action-confirm').close();pendingAction=null;return}
  if(action==='approve'&&pendingAction){
    const target=slots.find(s=>s.id===pendingAction.id);
    target.state=pendingAction.next;pendingAction=null;document.getElementById('action-confirm').close();render();
    notify(`Thao tác minh họa: ô ${target.id} chuyển sang “${status[target.state].label}”. Chưa lưu vào hệ thống.`);
    document.querySelector(`[data-slot="${target.id}"]`)?.focus({preventScroll:true});return;
  }
  if(action==='find'){findFree();return}
  if(action==='next'){findFree(true);return}
  if(action==='map'){document.querySelector('.map-panel').scrollIntoView({behavior:'instant',block:'start'});document.querySelector(`[data-slot="${selected}"]`)?.focus({preventScroll:true});return}
  if(action==='unknown'){selected='B-03';zone='B';filter='unknown';render();document.querySelector('[data-slot="B-03"]').focus({preventScroll:true});return}
  if(action==='reset'){slots.forEach((s,i)=>s.state=initial[i]);selected='A-02';zone='all';filter='all';query='';render();notify('Đã khôi phục 24 ô mẫu ban đầu.');return}
  if(action==='camera'){document.getElementById('camera').scrollIntoView({behavior:'instant',block:'center'});document.querySelector('[data-action="reconnect"]').focus({preventScroll:true});return}
  if(action==='reconnect'){notify('Đây là trạng thái minh họa. Khi triển khai, nút này sẽ thử lại nguồn hình và báo kết quả kết nối.');return}
  if(['reserve','confirm','cancel'].includes(action)){
    const next={reserve:'reserved',confirm:'occupied',cancel:'empty'}[action];
    const label={reserve:'giữ chỗ',confirm:'xác nhận xe vào',cancel:'hủy giữ chỗ'}[action];
    pendingAction={id:s.id,next};
    document.getElementById('confirm-title').textContent=`Thử ${label} ô ${s.id}?`;
    document.getElementById('confirm-description').textContent=`Ô này sẽ chuyển sang “${status[next].label}”. Chỉ dữ liệu mẫu trên trang này thay đổi, chưa lưu vào hệ thống.`;
    document.getElementById('action-confirm').showModal();
  }
});
document.addEventListener('input',e=>{if(e.target.id!=='slot-search')return;query=e.target.value;const start=e.target.selectionStart;render();const input=document.getElementById('slot-search');input.focus({preventScroll:true});input.setSelectionRange(start,start)});
document.addEventListener('change',e=>{if(e.target.id==='status-filter'){filter=e.target.value;render();document.getElementById('status-filter').focus({preventScroll:true})}});
document.getElementById('action-confirm').addEventListener('cancel',()=>{pendingAction=null});
render();
