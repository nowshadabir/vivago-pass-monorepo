"use strict";(()=>{var ne=new WeakMap,oe=new WeakMap,ee=new Map,Ie=0,re=["login","signup","change-password","reset-password"],ke=["username","email","current-password","password"],ae=["new-password","confirm-password"];function v(e){let t=e.getBoundingClientRect();return t.width>0&&t.height>0&&window.getComputedStyle(e).display!=="none"&&window.getComputedStyle(e).visibility!=="hidden"}function He(e){if(e.id)try{let o=document.querySelector(`label[for="${CSS.escape(e.id)}"]`);if(o?.textContent)return o.textContent.trim()}catch{let o=document.querySelector(`label[for="${e.id}"]`);if(o?.textContent)return o.textContent.trim()}let t=e.closest("label");if(t?.textContent)return t.textContent.trim();let n=e.previousElementSibling;return n?.tagName==="LABEL"&&n.textContent?n.textContent.trim():""}function D(e){return[e.name,e.id,e.placeholder,e.getAttribute("aria-label")||"",He(e)].join(" ").toLowerCase()}function Se(e){let n=e.querySelector("h1, h2, h3, legend, [role='heading']")?.textContent?.trim()||"",o=Array.from(e.querySelectorAll("button, input[type='submit']")).map(r=>r.textContent||r.value||"").join(" ");return`${n} ${o} ${e.getAttribute("aria-label")||""}`.toLowerCase()}function Fe(){return`${window.location.pathname}${window.location.search}${document.title}`.toLowerCase()}function G(e){return Array.from(e.querySelectorAll("input")).filter(t=>v(t))}function H(e){let t=(e.type||"text").toLowerCase();return["hidden","checkbox","radio","file","range","color","submit","button","reset","image"].includes(t)}function S(e){if((e.type||"text").toLowerCase()==="search")return!0;let n=D(e);return/search|find|query|filter/.test(n)}function F(e){return!!e.closest(".vivago-suggestions-dropdown, .vivago-save-banner, [data-vivago]")}function ie(e){let t=(e.type||"text").toLowerCase(),n=(e.autocomplete||"").toLowerCase(),o=D(e);return n==="username"?"username":n==="email"?"email":n==="current-password"?"current-password":n==="new-password"?"new-password":n.includes("tel")?"phone":n.includes("one-time-code")||n==="otp"?"otp":n.includes("cc-number")?"card-number":n.includes("cc-exp")?"card-expiry":n.includes("cc-csc")||n.includes("cc-cvv")?"card-cvc":n.includes("given-name")?"first-name":n.includes("family-name")?"last-name":n.includes("name")&&!n.includes("username")?"name":n.includes("organization")?"organization":n.includes("street-address")||n.includes("address-line")?"address":t==="email"?"email":t==="tel"?"phone":t==="password"?/confirm|repeat|verify|retype|again/.test(o)?"confirm-password":/new|create|choose|set.?up/.test(o)?"new-password":/current|old|existing/.test(o)?"current-password":null:/otp|one.?time|verification.?code|2fa|mfa|authenticator/.test(o)?"otp":/user|login|account/.test(o)&&!/name/.test(o)?"username":/email|e-mail/.test(o)?"email":/phone|mobile|tel/.test(o)?"phone":/first.?name|fname|given/.test(o)?"first-name":/last.?name|lname|surname|family/.test(o)?"last-name":/full.?name|^name$/.test(o)?"name":/address|street|city|zip|postal/.test(o)?"address":/company|organization|org/.test(o)?"organization":/card.?number|cc-num/.test(o)?"card-number":/expir|exp.?date|mm.?yy/.test(o)?"card-expiry":/cvv|cvc|security.?code/.test(o)?"card-cvc":null}function Ae(e,t,n){if(e.length===0)return;let o=(r,i)=>{let a=n.get(r);(!a||a==="password"||a==="generic"||i==="confirm-password"&&a!=="current-password")&&n.set(r,i)};if(t==="login"){e.forEach(r=>o(r,"current-password"));return}if(t==="reset-password"){e.length===1?o(e[0],"new-password"):(o(e[0],"new-password"),o(e[e.length-1],"confirm-password"));return}if(t==="change-password"){if(e.length===1)o(e[0],"new-password");else if(e.length===2)e.some(i=>n.get(i)==="current-password")?e.forEach(i=>{n.get(i)!=="current-password"&&o(i,"new-password")}):(o(e[0],"new-password"),o(e[1],"confirm-password"));else{o(e[0],"current-password"),o(e[1],"new-password"),o(e[2],"confirm-password");for(let r=3;r<e.length;r++)o(e[r],"confirm-password")}return}if(t==="signup")if(e.length===1)o(e[0],"new-password");else{o(e[0],"new-password"),o(e[e.length-1],"confirm-password");for(let r=1;r<e.length-1;r++)n.get(e[r])!=="new-password"&&o(e[r],"new-password")}}function Y(e,t){let n=new Map;for(let r of e){if(H(r)||S(r)||F(r)){n.set(r,"ignored");continue}n.set(r,ie(r)||"generic")}let o=e.filter(r=>(r.type||"").toLowerCase()==="password");return Ae(o,t,n),n}function te(e,t,n){let o=t.filter(f=>(f.type||"").toLowerCase()==="password"),r=[...n.values()],i=Se(e),a=Fe(),s=`${i} ${a}`,l=r.includes("current-password"),c=r.includes("new-password"),d=r.includes("confirm-password"),p=r.some(f=>f==="username"||f==="email"),g=r.some(f=>["card-number","card-expiry","card-cvc"].includes(f)),m=r.includes("otp"),y=r.some(f=>["name","first-name","last-name","phone","address","organization"].includes(f));return g||/checkout|payment|billing|card.?number/.test(s)?"payment":m&&o.length===0?"otp":o.length===0?y?"identity":"unknown":l&&(c||d||o.length>=2)?"change-password":/reset|forgot.?password|recover/.test(s)&&!l?"reset-password":/signup|sign.?up|register|create.?account|join|get.?started/.test(s)&&o.length>=1?"signup":c&&d?/reset|forgot/.test(s)?"reset-password":"signup":o.length>=2&&!l?/signup|register|create|join/.test(s)?"signup":"reset-password":o.length===1&&(p||/login|sign.?in|log.?in/.test(s))?"login":o.length===1&&/signup|register/.test(s)?"signup":o.length>=3?"change-password":o.length>=2?"signup":"unknown"}function _(e){return e.some(t=>{if(H(t)||S(t)||F(t))return!1;if((t.type||"text").toLowerCase()==="password")return!0;let o=ie(t);if(o&&o!=="generic"&&o!=="ignored")return!0;let r=D(t);return/user|email|login|pass|phone|tel|account|otp|card|name|address/.test(r)})}function Pe(e){let t=e.closest('[role="dialog"], dialog, [class*="modal" i], [class*="dialog" i], [id*="modal" i], [data-testid*="modal" i]');if(t&&v(t))return t;let n=e.parentElement,o=e.parentElement||document.body,r=0;for(;n&&n!==document.body&&r<10;){let i=G(n);_(i)&&(o=n),n=n.parentElement,r++}return o}function Re(){let e=[],t=new Set,n=new Set;document.querySelectorAll("form").forEach(i=>{let a=i;if(!v(a))return;let s=G(a);_(s)&&(n.has(a)||(e.push(a),n.add(a),s.forEach(l=>t.add(l))))});let o=Array.from(document.querySelectorAll("input")).filter(i=>{let a=i;return v(a)&&!t.has(a)&&!F(a)&&!H(a)&&!S(a)}),r=new Map;for(let i of o){if(!_([i]))continue;let a=Pe(i);r.has(a)||r.set(a,[]),r.get(a).push(i),a.tagName==="FORM"&&!n.has(a)&&n.add(a)}return r.forEach((i,a)=>{i.length!==0&&(n.has(a)||(n.add(a),e.push(a),i.forEach(s=>t.add(s))))}),e}function Ne(e){let t=G(e).filter(c=>!H(c)&&!S(c)&&!F(c)),n=te(e,t,Y(t,"unknown")),o=Y(t,n),r=te(e,t,o),i=r!==n?Y(t,r):o,a=t.map(c=>({input:c,role:i.get(c)||"generic"})),s=c=>a.find(d=>d.role===c)?.input??null;return{id:`vivago-form-${++Ie}`,root:e,type:r,fields:a,usernameField:s("username")||s("email"),currentPasswordField:s("current-password"),newPasswordField:s("new-password"),confirmPasswordField:s("confirm-password")}}function j(){ee.clear();let e=Re();for(let t of e){let n=Ne(t);ee.set(n.id,n);for(let{input:o,role:r}of n.fields)ne.set(o,n),oe.set(o,r)}}function w(e){return ne.get(e)??null}function T(e){return oe.get(e)??"generic"}function W(e){return w(e)?.type??"unknown"}function se(e){if(H(e)||S(e)||F(e))return!1;let t=T(e);if(t==="ignored")return!1;let n=w(e),o=n?.type??"unknown";if(re.includes(o))return ke.includes(t)||ae.includes(t)||t==="password";if(o==="identity")return["username","email","phone","name","first-name","last-name"].includes(t);if(o==="otp")return t==="otp";if(!n){if((e.type||"text").toLowerCase()==="password")return!0;let i=D(e);return/user|email|login|pass|phone|account/.test(i)}return!1}function $(e){let t=T(e);if(ae.includes(t))return!0;let n=w(e);return n?(n.type==="signup"||n.type==="reset-password"||n.type==="change-password")&&(t==="new-password"||t==="confirm-password"||(e.type||"").toLowerCase()==="password"&&e===n.newPasswordField||(e.type||"").toLowerCase()==="password"&&e===n.confirmPasswordField):!1}function X(e){let t=T(e),o=w(e)?.type??"unknown";return t==="current-password"||t==="password"&&o==="login"?!0:t==="username"||t==="email"?re.includes(o)||o==="unknown":!1}function le(e){let t=w(e);return t?.confirmPasswordField&&t.confirmPasswordField!==e||T(e)==="new-password"&&t?t.confirmPasswordField:null}function ce(e){if($(e))return"Password";switch(w(e)?.type??"unknown"){case"signup":return"Sign up with...";case"change-password":return"Update password";case"reset-password":return"Reset password";case"login":default:return"Log in as..."}}function de(e){switch(e){case"login":return"Login";case"signup":return"Sign up";case"change-password":return"Change password";case"reset-password":return"Reset password";case"identity":return"Personal info";case"payment":return"Payment";case"otp":return"Verification";default:return"Form"}}(function(){let t=document.createElement("script");t.src=chrome.runtime.getURL("webauthn-bridge.js"),t.type="text/javascript",t.onload=()=>t.remove(),(document.head||document.documentElement).prepend(t)})();var b=null,u=null,K=new WeakSet,P=new WeakMap,he=chrome.runtime.getURL("logo.jpg"),E=[],q="",R=!1,ze=!1,C="";function J(e){let t=T(e);if(t==="email"||t==="username")return!0;let n=(e.type||"text").toLowerCase();return n==="email"||n==="username"}function be(e){if(!q||!J(e))return!1;let t=W(e);return t==="login"||t==="signup"||t==="unknown"}function M(e,t){return t.length>0||!be(e)?t:[{isAccountEmail:!0,name:"Your Vivago account",username:q}]}function pe(e){return M(e,E).length}var me="";function N(e){return new Promise(t=>{try{chrome.runtime.sendMessage(e,n=>{chrome.runtime.lastError?(console.warn("[Vivago] Extension context error:",chrome.runtime.lastError.message),t(null)):t(n)})}catch(n){console.warn("[Vivago] sendMessage error:",n),t(null)}})}chrome.runtime.onMessage.addListener((e,t,n)=>{if(e.type==="autofill-exec"){let o=Ce(e.username,e.password);n({success:o})}});async function Ve(){try{let e=await N({type:"check-auth"});if(!e?.isAuthenticated)return R=!1,q="",[];R=!0,q=(e.email||"").trim();let t=await N({type:"get-vault-items",domain:window.location.hostname});if(t?.success&&Array.isArray(t.items))return E=t.items,ze=!0,t.items}catch(e){console.warn("[Vivago] Failed to fetch vault items:",e)}return[]}function ye(e){if(e<=0)return 0;let t=new Uint32Array(1);return crypto.getRandomValues(t),t[0]%e}function A(e){return e.charAt(ye(e.length))}function Be(e){for(let t=e.length-1;t>0;t--){let n=ye(t+1);[e[t],e[n]]=[e[n],e[t]]}return e}function ue(e=20){let t="abcdefghijklmnopqrstuvwxyz",n="ABCDEFGHIJKLMNOPQRSTUVWXYZ",o="0123456789",r="!@#$%^&*()_+-=[]{}|;:,.<>?",i=t+n+o+r,a=[A(t),A(n),A(o),A(r)];for(let s=a.length;s<e;s++)a.push(A(i));return Be(a).join("")}function h(e,t){e.value=t,e.dispatchEvent(new Event("input",{bubbles:!0})),e.dispatchEvent(new Event("change",{bubbles:!0}))}function De(e,t){h(e,t);let n=le(e);n&&n!==e&&h(n,t),C=t,O=t,x()}function xe(e,t){let n=t.getBoundingClientRect(),o=window.pageXOffset||document.documentElement.scrollLeft,r=window.pageYOffset||document.documentElement.scrollTop,i=280;e.style.position="absolute",e.style.zIndex="2147483647",e.style.top=`${n.bottom+r+4}px`,e.style.left=`${Math.max(8,n.right+o-i)}px`,e.style.width=`${i}px`}function je(e){if(u=e,x(),$(e)){Z(e);return}if(X(e)){(e.type||"").toLowerCase()==="password"?We(e,E):z(e,M(e,E));return}let t=W(e);(t==="login"||t==="signup"||t==="unknown")&&z(e,M(e,E))}function $e(e){let t=document.createElement("div");t.className="vivago-field-icon",t.setAttribute("data-vivago","true"),t.style.display="none";let n=e>0?`<span class="vivago-icon-count">${e}</span>`:"";return t.innerHTML=`<img src="${he}" alt="" class="vivago-field-icon-img" />${n}`,t}function qe(e,t){let n=e.querySelector(".vivago-icon-count");if(t>0)if(n)n.textContent=String(t);else{let o=document.createElement("span");o.className="vivago-icon-count",o.textContent=String(t),e.appendChild(o)}else n&&n.remove()}function Oe(){document.querySelectorAll(".vivago-field-icon").forEach(e=>{e.style.display="none"})}function Ue(e,t){e.addEventListener("mousedown",n=>{n.preventDefault(),n.stopPropagation()}),e.addEventListener("click",n=>{n.preventDefault(),n.stopPropagation(),b&&u===t?x():je(t)})}function ge(e){Oe();let t=P.get(e);t?qe(t,pe(e)):(t=$e(pe(e)),P.set(e,t),Ue(t,e),document.body.appendChild(t)),document.body.contains(e)&&v(e)&&(Ee(t,e),t.style.display="")}function Ye(e){let t=P.get(e);t&&(t.style.display="none")}function Ee(e,t){let n=t.getBoundingClientRect(),o=window.pageXOffset||document.documentElement.scrollLeft,r=window.pageYOffset||document.documentElement.scrollTop,i=22;e.style.top=`${n.top+r+(n.height-i)/2}px`,e.style.left=`${n.right+o-i-6}px`}function _e(e){K.has(e)||(K.add(e),e.addEventListener("focus",()=>{if(!R)return;ge(e);let t=w(e);if(t&&t.id!==me&&(C="",me=t.id),$(e)){u=e,Z(e);return}X(e)&&be(e)&&E.length===0&&(u=e,z(e,M(e,E)))}),e.addEventListener("blur",()=>{setTimeout(()=>{document.activeElement!==e&&(b&&u===e||Ye(e))},120)}),document.activeElement===e&&ge(e))}function Le(){document.querySelectorAll("input").forEach(t=>{let n=t,o=P.get(n);o&&o.style.display!=="none"&&(document.body.contains(n)&&v(n)?Ee(o,n):o.style.display="none")})}function Ge(){let e=document.querySelectorAll("input"),t=new Set(e);document.querySelectorAll(".vivago-field-icon").forEach(n=>{let o=!0;t.forEach(r=>{P.get(r)===n&&(o=!1)}),o&&n.remove()})}function Z(e){U(),x(),C||(C=ue(20));let t=C,n=document.createElement("div");n.className="vivago-suggestions-dropdown vivago-generator-dropdown",n.setAttribute("data-vivago","true");let o=document.createElement("div");o.className="vivago-dropdown-header";let r=document.createElement("span");r.className="vivago-dropdown-header-text",r.textContent="Password";let i=document.createElement("div");i.className="vivago-dropdown-logo",i.innerHTML=`<img src="${he}" alt="" class="vivago-dropdown-logo-img" />`,o.appendChild(r),o.appendChild(i),n.appendChild(o);let a=document.createElement("div");a.className="vivago-dropdown-row vivago-generator-row";let s=document.createElement("div");s.className="vivago-row-badge vivago-generator-badge",s.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 1.5 1.5M15.5 7.5 14 6"/></svg>';let l=document.createElement("div");l.className="vivago-row-info";let c=document.createElement("div");c.className="vivago-row-name",c.textContent="Fill password";let d=document.createElement("div");d.className="vivago-row-user vivago-generator-password",d.textContent=t,l.appendChild(c),l.appendChild(d),a.appendChild(s),a.appendChild(l),a.addEventListener("mousedown",m=>{m.preventDefault(),m.stopPropagation(),De(e,t)});let p=document.createElement("div");p.className="vivago-dropdown-row vivago-generator-regen-row";let g=document.createElement("span");g.className="vivago-generator-regen",g.textContent="\u21BB Generate another",p.appendChild(g),p.addEventListener("mousedown",m=>{m.preventDefault(),m.stopPropagation(),C=ue(20),Z(e)}),n.appendChild(a),n.appendChild(p),document.body.appendChild(n),b=n,u=e,xe(n,e)}async function We(e,t){try{let r=((await chrome.runtime.sendMessage({type:"get-passkeys",domain:window.location.hostname}))?.passkeys||[]).map(a=>({...a,isPasskey:!0,icon:"\u{1F511}"})),i=[...t,...r];z(e,i.length>0?i:M(e,t))}catch(n){console.error("[Vivago] Error fetching passkeys:",n),z(e,M(e,t))}}function z(e,t){U();let n=document.createElement("div");n.className="vivago-suggestions-dropdown";let o=document.createElement("div");o.className="vivago-dropdown-header";let r=document.createElement("span");r.className="vivago-dropdown-header-text";let i=w(e);r.textContent=ce(e),i&&i.type!=="unknown"&&(r.title=`${de(i.type)} form`);let a=document.createElement("div");a.className="vivago-dropdown-logo",a.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 1.5 1.5M15.5 7.5 14 6"/></svg>',o.appendChild(r),o.appendChild(a),n.appendChild(o);let s=document.createElement("div");if(s.className="vivago-dropdown-scroll",t.length===0){let l=document.createElement("div");l.className="vivago-dropdown-row vivago-dropdown-empty";let c=document.createElement("div");c.className="vivago-row-badge",c.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 1.5 1.5M15.5 7.5 14 6"/></svg>';let d=document.createElement("div");d.className="vivago-row-info";let p=document.createElement("div");p.className="vivago-row-name",p.textContent="No logins found";let g=document.createElement("div");g.className="vivago-row-user",g.textContent="for "+window.location.hostname,d.appendChild(p),d.appendChild(g),l.appendChild(c),l.appendChild(d),s.appendChild(l)}else t.forEach(l=>{let c=document.createElement("div");c.className="vivago-dropdown-row";let d=document.createElement("div");d.className="vivago-row-badge",l.isPasskey?(d.textContent="\u{1F511}",d.style.fontSize="14px",d.style.display="flex",d.style.alignItems="center",d.style.justifyContent="center"):l.isAccountEmail?(d.className="vivago-row-badge vivago-account-badge",d.textContent=(l.username||"V").charAt(0).toUpperCase()):d.textContent=(l.name||"V").charAt(0).toUpperCase();let p=document.createElement("div");p.className="vivago-row-info";let g=document.createElement("div");g.className="vivago-row-name",g.textContent=l.name||(l.isPasskey?"Passkey":"Untitled");let m=document.createElement("div");m.className="vivago-row-user",m.textContent=l.isPasskey?l.domain||window.location.hostname:l.isAccountEmail?"Account email":l.username||"",p.appendChild(g),p.appendChild(m),c.appendChild(d),c.appendChild(p),c.addEventListener("mousedown",y=>{y.preventDefault(),y.stopPropagation(),l.isPasskey?Je(l,u):l.isAccountEmail?Xe(l.username):Ce(l.username,l.password),x()}),s.appendChild(c)});n.appendChild(s),document.body.appendChild(n),b=n,xe(n,e)}function x(){if(b){let e=b;b=null,e.style.animation="vivago-dropdown-out 0.15s cubic-bezier(0.4, 0, 1, 1) forwards",e.addEventListener("animationend",()=>e.remove(),{once:!0}),setTimeout(()=>{e.parentNode&&e.remove()},200)}}function Te(){if(u){let e=w(u);if(e)return e}j();for(let e of document.querySelectorAll('input[type="password"]')){let t=e;if(!v(t))continue;let n=w(t);if(n&&(n.type==="login"||n.type==="unknown"))return n}return null}function Xe(e){if(u&&J(u))return h(u,e),!0;let t=Te();if(t?.usernameField)return h(t.usernameField,e),!0;let o=Array.from(document.querySelectorAll("input")).filter(v).find(r=>J(r));return o?(h(o,e),!0):!1}function Ce(e,t){let n=!1,o=Te();if(o){o.usernameField&&(h(o.usernameField,e),n=!0);let r=o.currentPasswordField||o.fields.find(i=>i.role==="password")?.input||o.fields.find(i=>(i.input.type||"").toLowerCase()==="password")?.input;r&&(h(r,t),r.dispatchEvent(new Event("blur",{bubbles:!0})),n=!0)}else{let r=Array.from(document.querySelectorAll("input")),i=r.filter(a=>a.type==="password"&&v(a));if(i.length>0)for(let a of i){h(a,t),a.dispatchEvent(new Event("blur",{bubbles:!0})),n=!0;let l=r.slice(0,r.indexOf(a)).reverse().find(c=>(c.type==="text"||c.type==="email"||c.type==="username")&&v(c));l?h(l,e):u&&u.type!=="password"&&h(u,e)}else u&&u.type!=="password"&&(h(u,e),n=!0)}return n}function U(){let e="vivago-injected-styles";if(document.getElementById(e))return;let t=document.createElement("style");t.id=e,t.textContent=`
    /* ========== Field Icon ========== */
    .vivago-field-icon {
      position: absolute !important;
      width: 22px !important;
      height: 22px !important;
      border-radius: 50% !important;
      background: #fff !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      z-index: 2147483646 !important;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.18) !important;
      transition: transform 0.15s ease, box-shadow 0.15s ease !important;
      pointer-events: auto !important;
      box-sizing: border-box !important;
      padding: 0 !important;
      margin: 0 !important;
      line-height: 1 !important;
      overflow: hidden !important;
    }

    .vivago-field-icon:hover {
      transform: scale(1.12) !important;
      box-shadow: 0 3px 12px rgba(15, 23, 42, 0.28) !important;
    }

    .vivago-field-icon-img {
      width: 100% !important;
      height: 100% !important;
      object-fit: cover !important;
      display: block !important;
      border-radius: 50% !important;
      flex-shrink: 0 !important;
    }

    .vivago-icon-count {
      position: absolute !important;
      top: -5px !important;
      right: -5px !important;
      background: linear-gradient(135deg, #22c55e, #16a34a) !important;
      color: #fff !important;
      font-size: 8px !important;
      font-weight: 800 !important;
      width: 14px !important;
      height: 14px !important;
      border-radius: 50% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25) !important;
      line-height: 1 !important;
      border: 1.5px solid #fff !important;
      box-sizing: border-box !important;
    }

    /* ========== Dark Dropdown ========== */
    .vivago-suggestions-dropdown {
      background: #1a1a2e !important;
      border: 1px solid rgba(255, 255, 255, 0.07) !important;
      border-radius: 12px !important;
      box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.5),
                  0 0 0 1px rgba(255, 255, 255, 0.04),
                  0 0 30px -8px rgba(99, 102, 241, 0.12) !important;
      padding: 0 !important;
      display: flex !important;
      flex-direction: column !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      box-sizing: border-box !important;
      overflow: hidden !important;
      animation: vivago-dropdown-in 0.22s cubic-bezier(0.16, 1, 0.3, 1) !important;
      transform-origin: top right !important;
    }

    .vivago-dropdown-scroll {
      max-height: 260px !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      overscroll-behavior: contain !important;
      scrollbar-width: thin !important;
      scrollbar-color: rgba(165, 180, 252, 0.45) transparent !important;
    }

    .vivago-dropdown-scroll::-webkit-scrollbar {
      width: 6px !important;
    }

    .vivago-dropdown-scroll::-webkit-scrollbar-track {
      background: transparent !important;
    }

    .vivago-dropdown-scroll::-webkit-scrollbar-thumb {
      background: rgba(165, 180, 252, 0.4) !important;
      border-radius: 999px !important;
    }

    .vivago-dropdown-scroll::-webkit-scrollbar-thumb:hover {
      background: rgba(199, 210, 254, 0.55) !important;
    }

    @keyframes vivago-dropdown-in {
      from { opacity: 0; transform: translateY(-6px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes vivago-dropdown-out {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to { opacity: 0; transform: translateY(-4px) scale(0.97); }
    }

    .vivago-dropdown-header {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 10px 12px 8px 12px !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
    }

    .vivago-dropdown-header-text {
      font-size: 12px !important;
      font-weight: 700 !important;
      color: rgba(255, 255, 255, 0.8) !important;
      letter-spacing: 0.1px !important;
    }

    .vivago-dropdown-logo {
      width: 22px !important;
      height: 22px !important;
      background: #fff !important;
      border-radius: 6px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      box-shadow: 0 2px 6px rgba(15, 23, 42, 0.15) !important;
      overflow: hidden !important;
    }

    .vivago-dropdown-logo-img {
      width: 100% !important;
      height: 100% !important;
      object-fit: cover !important;
      display: block !important;
    }

    .vivago-generator-row {
      padding: 10px 12px !important;
    }

    .vivago-generator-badge {
      color: #a78bfa !important;
    }

    .vivago-generator-password {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
      font-size: 11px !important;
      color: #c4b5fd !important;
      letter-spacing: 0.02em !important;
      word-break: break-all !important;
      white-space: normal !important;
      line-height: 1.35 !important;
    }

    .vivago-generator-regen-row {
      border-top: 1px solid rgba(255, 255, 255, 0.06) !important;
      justify-content: center !important;
      padding: 7px 12px !important;
    }

    .vivago-generator-regen-row:hover {
      background-color: rgba(255, 255, 255, 0.04) !important;
    }

    .vivago-generator-regen {
      font-size: 11px !important;
      font-weight: 600 !important;
      color: #94a3b8 !important;
      cursor: pointer !important;
    }

    .vivago-generator-regen-row:hover .vivago-generator-regen {
      color: #c4b5fd !important;
    }

    .vivago-dropdown-row {
      display: flex !important;
      align-items: center !important;
      gap: 9px !important;
      padding: 8px 12px !important;
      cursor: pointer !important;
      transition: background-color 0.15s ease, transform 0.1s ease !important;
    }

    .vivago-dropdown-row:hover {
      background-color: rgba(255, 255, 255, 0.05) !important;
    }

    .vivago-dropdown-row:active {
      background-color: rgba(255, 255, 255, 0.08) !important;
    }

    .vivago-dropdown-row:last-child {
      border-radius: 0 0 12px 12px !important;
    }

    .vivago-dropdown-empty {
      cursor: default !important;
      opacity: 0.55 !important;
    }

    .vivago-dropdown-empty:hover {
      background-color: transparent !important;
    }

    .vivago-row-badge {
      background: rgba(139, 92, 246, 0.15) !important;
      color: #a78bfa !important;
      border-radius: 8px !important;
      width: 30px !important;
      height: 30px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-weight: 800 !important;
      font-size: 12px !important;
      flex-shrink: 0 !important;
      border: 1px solid rgba(139, 92, 246, 0.1) !important;
    }

    .vivago-row-info {
      display: flex !important;
      flex-direction: column !important;
      gap: 2px !important;
      overflow: hidden !important;
      flex: 1 !important;
    }

    .vivago-row-name {
      font-size: 12px !important;
      font-weight: 600 !important;
      color: #e2e8f0 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }

    .vivago-account-badge {
      background: rgba(99, 102, 241, 0.2) !important;
      color: #c7d2fe !important;
      border-color: rgba(99, 102, 241, 0.25) !important;
    }

    .vivago-row-user {
      font-size: 10.5px !important;
      color: #94a3b8 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }

    /* ========== Save/Update Banner (light theme) ========== */
    .vivago-save-banner {
      position: fixed !important;
      top: 16px !important;
      right: 16px !important;
      z-index: 2147483647 !important;
      background-color: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      box-shadow: 0 20px 40px -8px rgba(0, 0, 0, 0.12), 0 8px 16px -4px rgba(0, 0, 0, 0.06) !important;
      border-radius: 16px !important;
      width: 360px !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      overflow: hidden !important;
      animation: vivago-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }

    @keyframes vivago-slide-in {
      from { opacity: 0; transform: translateY(-12px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .vivago-banner-header {
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      padding: 14px 16px 10px 16px !important;
      border-bottom: 1px solid #f1f5f9 !important;
    }

    .vivago-banner-logo {
      background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
      border-radius: 8px !important;
      width: 28px !important;
      height: 28px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 14px !important;
      flex-shrink: 0 !important;
      box-shadow: 0 2px 6px rgba(99, 102, 241, 0.3) !important;
    }

    .vivago-banner-title {
      font-size: 14px !important;
      font-weight: 700 !important;
      color: #1e293b !important;
      flex: 1 !important;
    }

    .vivago-banner-close {
      background: none !important;
      border: none !important;
      width: 28px !important;
      height: 28px !important;
      border-radius: 8px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      color: #94a3b8 !important;
      font-size: 16px !important;
      transition: all 0.15s ease !important;
      flex-shrink: 0 !important;
    }

    .vivago-banner-close:hover {
      background-color: #f1f5f9 !important;
      color: #475569 !important;
    }

    .vivago-banner-body {
      padding: 12px 16px !important;
    }

    .vivago-banner-credential {
      display: flex !important;
      align-items: center !important;
      gap: 12px !important;
      padding: 10px 12px !important;
      background-color: #f8fafc !important;
      border: 1px solid #f1f5f9 !important;
      border-radius: 12px !important;
    }

    .vivago-banner-avatar {
      width: 36px !important;
      height: 36px !important;
      border-radius: 50% !important;
      background: linear-gradient(135deg, #e0e7ff, #c7d2fe) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex-shrink: 0 !important;
      color: #6366f1 !important;
      font-weight: 800 !important;
      font-size: 14px !important;
    }

    .vivago-banner-cred-info {
      display: flex !important;
      flex-direction: column !important;
      gap: 1px !important;
      overflow: hidden !important;
      flex: 1 !important;
    }

    .vivago-banner-hostname {
      font-size: 13px !important;
      font-weight: 700 !important;
      color: #1e293b !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }

    .vivago-banner-email {
      font-size: 11.5px !important;
      color: #64748b !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }

    .vivago-banner-actions {
      display: flex !important;
      align-items: center !important;
      justify-content: flex-end !important;
      gap: 6px !important;
      padding: 10px 16px 14px 16px !important;
    }

    .vivago-banner-btn-primary {
      background: linear-gradient(135deg, #6366f1, #7c3aed) !important;
      color: #ffffff !important;
      border: none !important;
      border-radius: 10px !important;
      padding: 9px 18px !important;
      font-size: 12.5px !important;
      font-weight: 700 !important;
      cursor: pointer !important;
      transition: all 0.2s ease !important;
      box-shadow: 0 2px 8px rgba(99, 102, 241, 0.25) !important;
    }

    .vivago-banner-btn-primary:hover {
      background: linear-gradient(135deg, #4f46e5, #6d28d9) !important;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35) !important;
      transform: translateY(-1px) !important;
    }

    .vivago-banner-btn-primary:disabled {
      opacity: 0.7 !important;
      cursor: not-allowed !important;
      transform: none !important;
    }

    .vivago-banner-btn-secondary {
      background: transparent !important;
      color: #6366f1 !important;
      border: none !important;
      border-radius: 10px !important;
      padding: 9px 14px !important;
      font-size: 12.5px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      transition: all 0.15s ease !important;
    }

    .vivago-banner-btn-secondary:hover {
      background-color: #f1f5f9 !important;
      color: #4f46e5 !important;
    }

    /* Success state */
    .vivago-banner-success .vivago-banner-credential {
      background-color: #f0fdf4 !important;
      border-color: #bbf7d0 !important;
    }

    .vivago-banner-success .vivago-banner-avatar {
      background: linear-gradient(135deg, #dcfce7, #bbf7d0) !important;
      color: #16a34a !important;
    }
  `,document.head.appendChild(t)}function fe(){if(!R)return;j(),document.querySelectorAll("input").forEach(t=>{let n=t;K.has(n)||v(n)&&se(n)&&_e(n)})}async function ve(){if(U(),await Ve(),!R)return;fe(),new MutationObserver(()=>{requestAnimationFrame(()=>{j(),fe(),Ge()})}).observe(document.documentElement,{childList:!0,subtree:!0})}window.addEventListener("scroll",()=>{Le(),x()},!0);window.addEventListener("resize",()=>{Le(),x()});document.addEventListener("click",e=>{let t=e.target;b&&!b.contains(t)&&!t.closest(".vivago-field-icon")&&!(u&&u.contains(t))&&x()});document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>setTimeout(ve,300)):setTimeout(ve,300);var Q="",O="";document.addEventListener("input",e=>{let t=e.target;t instanceof HTMLInputElement&&(t.type==="password"?O=t.value:(t.type==="text"||t.type==="email"||t.type==="username")&&(Q=t.value))});document.addEventListener("submit",e=>{Me()});document.addEventListener("click",e=>{let t=e.target;(t.closest("button[type='submit'], input[type='submit']")||t.closest("button")&&/sign|log|next|submit|enter/i.test(t.textContent||""))&&setTimeout(Me,50)});async function Me(){if(!Q||!O)return;let e=Q.trim(),t=O,n=window.location.hostname,o=window.location.href;try{if(!(await N({type:"check-auth"}))?.isAuthenticated)return;let i=await N({type:"get-vault-items",domain:n}),a=null,s=!1;if(i?.success&&i.items&&i.items.length>0){if(i.items.find(d=>d.type==="login"&&(d.username||"").toLowerCase()===e.toLowerCase()&&d.password===t))return;let c=i.items.find(d=>d.type==="login"&&(d.username||"").toLowerCase()===e.toLowerCase());c&&(a=c.id,s=!0)}Ke(n,o,e,t,s,a)}catch(r){console.error("Failed to process form credentials:",r)}}function Ke(e,t,n,o,r=!1,i=null){let a="vivago-save-password-banner";if(document.getElementById(a))return;U();let s=document.createElement("div");s.id=a,s.className="vivago-save-banner";let l=document.createElement("div");l.className="vivago-banner-header";let c=document.createElement("div");c.className="vivago-banner-logo",c.textContent="\u{1F511}";let d=document.createElement("div");d.className="vivago-banner-title",d.textContent=r?"Update login":"Save login";let p=document.createElement("button");p.className="vivago-banner-close",p.innerHTML="\u2715",p.addEventListener("click",()=>s.remove()),l.appendChild(c),l.appendChild(d),l.appendChild(p);let g=document.createElement("div");g.className="vivago-banner-body";let m=document.createElement("div");m.className="vivago-banner-credential";let y=document.createElement("div");y.className="vivago-banner-avatar",y.textContent=(n||"U").charAt(0).toUpperCase();let f=document.createElement("div");f.className="vivago-banner-cred-info";let I=document.createElement("div");I.className="vivago-banner-hostname",I.textContent=e;let k=document.createElement("div");k.className="vivago-banner-email",k.textContent=n,f.appendChild(I),f.appendChild(k),m.appendChild(y),m.appendChild(f),g.appendChild(m);let L=document.createElement("div");L.className="vivago-banner-actions";let V=document.createElement("button");V.className="vivago-banner-btn-secondary",V.textContent=r?"Create new login":"Never",V.addEventListener("click",()=>{r?we(s,d,I,k,L,e,t,n,o,!1,null):s.remove()});let B=document.createElement("button");B.className="vivago-banner-btn-primary",B.textContent=r?"Update this login":"Save",B.addEventListener("click",()=>{we(s,d,I,k,L,e,t,n,o,r,i)}),L.appendChild(V),L.appendChild(B),s.appendChild(l),s.appendChild(g),s.appendChild(L),document.body.appendChild(s)}async function we(e,t,n,o,r,i,a,s,l,c,d){let p=r.querySelector(".vivago-banner-btn-primary");p&&(p.disabled=!0,p.textContent=c?"Updating...":"Saving...");let g={id:c&&d?d:"itm_"+Math.random().toString(36).substr(2,9),name:i,type:"login",username:s,password:l,url:a,notes:c?"Password updated by Vivago Pass browser extension":"Auto-saved by Vivago Pass browser extension"};try{let m=await N({type:"save-vault-item",item:g});m?.success?(e.classList.add("vivago-banner-success"),t.textContent=c?"Password updated!":"Saved successfully!",n.textContent="Credentials are secure in your vault.",o.textContent="",r.style.display="none",setTimeout(()=>e.remove(),2500)):(alert("Failed to save to vault: "+(m?.error||"Unknown error")),p&&(p.disabled=!1,p.textContent=c?"Update this login":"Save"))}catch(m){alert("Error: "+m.message),p&&(p.disabled=!1,p.textContent=c?"Update this login":"Save")}}window.addEventListener("message",async e=>{if(e.source===window){if(e.data.type==="VIVAGO_PASSKEY_CREATED"){console.log("[Vivago] Passkey created - saving to vault");try{let t=e.data.credential,n=window.location.hostname,o=await chrome.runtime.sendMessage({type:"save-passkey",passkey:t,domain:n});o?.success?console.log("[Vivago] Passkey saved successfully:",o.message):console.error("[Vivago] Failed to save passkey:",o?.error)}catch(t){console.error("[Vivago] Error saving passkey:",t.message)}}e.data.type==="VIVAGO_PASSKEY_RETRIEVED"&&console.log("[Vivago] Passkey retrieved - authentication successful")}});async function Je(e,t){try{console.log("[Vivago] Initiating passkey authentication"),alert(`Passkey authentication initiated for: ${e.name}

Browser will prompt you to authenticate.`),await chrome.runtime.sendMessage({type:"authenticate-passkey",passkeyId:e.id||e.credentialId,domain:window.location.hostname})}catch(n){console.error("[Vivago] Passkey authentication error:",n.message)}}})();
