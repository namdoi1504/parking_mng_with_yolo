/* Visual prototype only. No credential collection, storage or backend calls. */
const password=document.getElementById('password');
const reveal=document.getElementById('reveal');
const notification=document.getElementById('notification');
let timer;
function showHelp(){
  clearTimeout(timer);
  notification.textContent='Khi dùng hệ thống thật, liên hệ quản trị viên bãi xe để được cấp tài khoản hoặc hỗ trợ đặt lại mật khẩu.';
  notification.classList.add('visible');
  timer=setTimeout(()=>notification.classList.remove('visible'),6500);
}
reveal.addEventListener('click',()=>{
  const visible=password.type==='password';
  password.type=visible?'text':'password';
  reveal.setAttribute('aria-pressed',String(visible));
  reveal.setAttribute('aria-label',visible?'Ẩn mật khẩu mẫu':'Hiện mật khẩu mẫu');
});
document.getElementById('help').addEventListener('click',showHelp);
document.getElementById('contact').addEventListener('click',showHelp);
document.getElementById('preview-form').addEventListener('submit',event=>{
  event.preventDefault();
  window.location.assign('index.html?view=operator');
});
