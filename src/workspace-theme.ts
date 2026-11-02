/** Shared responsive workspace visual system: transit signage on white and mist,
 * one orange accent, an amber LED for live state. Fonts are self-hosted and
 * declared by workspaceHtml because their URLs are content-hashed. */
const SHELL_CSS = `
:root{--orange:#EC5C20;--orange-soft:#FFE4D6;--action:#B5441B;--action-hover:#8A3214;--ink:#17191B;--ink-soft:#4B5361;--muted:#5B636E;--faint:#A0A6AF;--strong:#8A929D;--mist:#F4F5F7;--mist-2:#F2F3F5;--line:#E3E6EA;--line-2:#E6E8EB;--white:#FFFFFF;--night:#0D0F11;--amber:#FFB45E;--green:#1FA463;--green-text:#1F7A4A;--warn:#B87300;--warn-text:#8A5A00;--danger:#B42318;
--sans:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;--display:"Inter Display","Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
--tile-shadow:0 0 0 1px rgba(16,24,40,.06),0 1px 3px rgba(16,24,40,.08);--ease:cubic-bezier(.16,1,.3,1);--tabs-space:calc(116px + env(safe-area-inset-bottom));color-scheme:light;font-family:var(--sans);color:var(--ink);background:var(--white);font-synthesis:none}
*,*::before,*::after{box-sizing:border-box}html{scroll-padding-top:24px;-webkit-text-size-adjust:100%;text-size-adjust:100%}body{margin:0;font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;background:var(--white)}[hidden]{display:none!important}
a{color:var(--action);text-underline-offset:3px}a:hover{color:var(--action-hover)}button,input,textarea,select{font:inherit;color:inherit}button{cursor:pointer}button:disabled{cursor:not-allowed;opacity:.55}button,a,summary,label{-webkit-tap-highlight-color:transparent;touch-action:manipulation}:focus-visible{outline:2px solid var(--orange);outline-offset:3px}::selection{background:#FFD8C4;color:var(--ink)}
input::placeholder,textarea::placeholder{color:#6B727D;opacity:1}p{margin:0 0 16px;max-width:68ch}h1,h2,h3{margin:0;line-height:1.2;font-weight:600;letter-spacing:-.02em;text-wrap:balance}small,.small{font-size:13px}.muted{color:var(--muted)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
svg{flex:none}.i{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.hidden-link{position:absolute;top:-80px;left:16px;z-index:20;padding:12px 18px;border-radius:999px;background:var(--white);color:var(--ink);box-shadow:var(--tile-shadow)}.hidden-link:focus{top:12px}

/* Shell: a mist sidebar and a white pane on desktop; a top bar and floating tabs on phones. */
.shell{display:grid;grid-template-columns:264px minmax(0,1fr);min-height:100vh;min-height:100svh;background:var(--mist)}
.sidebar{position:sticky;top:0;display:flex;flex-direction:column;height:100vh;height:100svh;padding:22px 14px 16px;overflow-y:auto}
.brand{display:block;width:105px;height:35px;margin-left:4px}.brand img{display:block;width:105px;height:35px}.brand-text{font:700 22px/35px var(--display);letter-spacing:-.04em;color:var(--ink);text-decoration:none}
.snav{display:flex;flex-direction:column;gap:2px;margin-top:26px}.snav a{display:flex;align-items:center;gap:10px;height:40px;padding:0 12px;border-radius:12px;color:var(--ink-soft);font-size:14.5px;font-weight:500;text-decoration:none;transition:background-color .15s,color .15s}.snav a:hover{background:rgba(23,25,27,.04);color:var(--ink)}.snav a[aria-current=page]{background:var(--white);color:var(--ink);font-weight:600;box-shadow:0 1px 2px rgba(16,24,40,.06),0 0 0 1px rgba(16,24,40,.04)}.snav .i{width:18px;height:18px}
.slabel{margin:26px 12px 6px;font-size:12px;line-height:16px;font-weight:600;color:var(--muted)}
.sitem{display:flex;align-items:center;gap:10px;height:40px;padding:0 12px 0 8px;border-radius:12px;color:var(--ink);font-size:14.5px;font-weight:500;text-decoration:none;transition:background-color .15s}.sitem:hover{color:var(--ink);background:rgba(23,25,27,.04)}.sitem[aria-current=page]{background:rgba(23,25,27,.055)}.sitem span:not([class]){flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.sitem .ok,.sitem .wait{margin-left:auto}
.acct{display:flex;align-items:center;gap:10px;min-height:48px;margin-top:auto;padding:0 10px;border-radius:12px;color:var(--ink-soft);font-size:13.5px;text-decoration:none}.acct:hover{color:var(--ink);background:rgba(23,25,27,.04)}.acct span:last-child{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.av{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--ink);color:var(--white);font:600 12px/1 var(--sans);text-decoration:none;flex:none}.av .i{width:16px;height:16px}
.pane{min-width:0;margin:12px 12px 12px 0;border-radius:24px;background:var(--white);box-shadow:0 0 0 1px rgba(16,24,40,.05),0 12px 32px -22px rgba(16,24,40,.3)}
.main{width:100%;min-height:calc(100vh - 24px);min-height:calc(100svh - 24px);padding:22px 56px 64px;outline:none}
.mtop,.tabs{display:none}
.navigation-error{margin:12px 12px 0;padding:12px 16px;border-radius:14px;background:#FEF3F2;color:var(--danger);font-size:14px}

/* Page furniture */
.crumbs{display:flex;align-items:center;gap:8px;min-height:36px;font-size:14px;color:var(--muted)}.crumbs a{color:var(--ink-soft);text-decoration:none}.crumbs a:hover{color:var(--ink)}
.saved{display:inline-flex;align-items:center;gap:6px;margin-left:auto;color:var(--green-text);font-weight:600;font-size:14px;transition:opacity .3s}.saved .i{width:16px;height:16px}.saved.busy{color:var(--muted);font-weight:500}.saved.failed{color:var(--danger)}
.back{display:inline-flex;align-items:center;gap:6px;min-height:36px;color:var(--ink-soft);font-size:15px;font-weight:500;text-decoration:none}.back:hover{color:var(--ink)}.back .i{width:18px;height:18px}
.ib{display:grid;place-items:center;width:40px;height:40px;padding:0;border:0;border-radius:50%;background:var(--mist-2);color:var(--ink);text-decoration:none;flex:none;transition:transform .15s var(--ease),background-color .15s}.ib:hover{color:var(--ink);background:#E9EBEE}.ib:active{transform:scale(.94)}.ib.lg{width:54px;height:54px}
.flowtop{display:none}
.h1{margin:0;font:600 44px/48px var(--display);letter-spacing:-.034em;text-wrap:balance}.lead{margin:12px 0 0;font-size:17px;line-height:25px;color:var(--ink-soft);text-wrap:pretty;max-width:52ch}
.label{display:flex;align-items:center;gap:7px;margin:0 0 10px 2px;font-size:13px;line-height:18px;font-weight:600;letter-spacing:0;color:var(--ink-soft)}.label .i{width:15px;height:15px}
.page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin:20px 0 36px}.page-head h1{font:600 44px/48px var(--display);letter-spacing:-.034em}.page-head p{margin:12px 0 0;color:var(--ink-soft);font-size:17px;line-height:25px;max-width:55ch}.head-action{margin-top:4px}
.narrow{max-width:600px}.wide{max-width:720px}
.chooser .h1{margin-top:28px}.chooser .label{margin-top:32px}.chooser .label.second{margin-top:28px}.chooser .desk-list{margin-top:28px}

/* Grouped lists */
.group{display:flex;flex-direction:column;border-radius:22px;background:var(--mist)}
.row{position:relative;display:flex;align-items:center;gap:14px;min-height:72px;padding:0 16px 0 14px;border:0;background:transparent;color:var(--ink);font:inherit;text-align:left;text-decoration:none;cursor:pointer;transition:background-color .15s}.row:hover{color:var(--ink);background:rgba(23,25,27,.025)}.row:first-child{border-radius:22px 22px 0 0}.row:last-child{border-radius:0 0 22px 22px}.row:only-child{border-radius:22px}.row:active{background:rgba(23,25,27,.05)}
.row+.row::before{content:"";position:absolute;top:0;left:68px;right:16px;height:1px;background:var(--line)}.row.short{min-height:60px}.row[aria-busy=true]{pointer-events:none}.row[aria-busy=true] .chev{opacity:0}
.rt{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}.rt b{font-size:17px;line-height:22px;font-weight:600;letter-spacing:-.014em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rt>span{font-size:14px;line-height:19px;color:var(--muted)}
.chev{width:16px;height:16px;color:var(--faint)}
.st{display:flex;align-items:center;gap:7px;font-size:14px;line-height:19px;color:var(--muted)}.st.warn{color:var(--warn-text)}
.ok,.wait,.idle{width:7px;height:7px;border-radius:50%;flex:none}.ok{background:var(--green);box-shadow:0 0 0 3px rgba(31,164,99,.16)}.wait{box-shadow:inset 0 0 0 1.6px var(--warn)}.idle{background:#C3C9D0}
.spin{width:16px;height:16px;border-radius:50%;border:2px solid rgba(23,25,27,.14);border-top-color:var(--ink);animation:spin .8s linear infinite;flex:none}
.more{display:flex;align-items:center;gap:14px;width:100%;min-height:64px;margin-top:8px;padding:0 16px 0 2px;border:0;background:transparent;color:var(--ink);font:inherit;text-align:left;cursor:pointer}.more .rt b{font-size:16px;color:var(--ink-soft)}.more .chev{transition:transform .25s var(--ease)}.more[aria-expanded=true] .chev{transform:rotate(180deg)}

/* Tiles: app icons on white, and the bus cropped from the logo for Hitchhike itself. */
.tile{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:var(--white);box-shadow:var(--tile-shadow);flex:none;overflow:hidden}.tile img{display:block;width:26px;height:26px;object-fit:contain}.tile.full img{width:100%;height:100%}
.tile.lg{width:52px;height:52px;border-radius:15px}.tile.lg img{width:34px;height:34px}.tile.lg.full img{width:100%;height:100%}
.tile.xl{width:76px;height:76px;border-radius:22px;box-shadow:0 0 0 1px rgba(16,24,40,.06),0 2px 6px rgba(16,24,40,.08)}.tile.xl img{width:48px;height:48px}.tile.xl.full img{width:100%;height:100%}
.tile.add,.mini.add{background:transparent;box-shadow:inset 0 0 0 1.5px #C3C9D0;color:var(--ink-soft)}.tile.add .i{width:18px;height:18px}.mini.add .i{width:14px;height:14px}.add-label{font-size:16px!important}
.tile .glyph{font:600 17px/1 var(--sans);color:var(--ink-soft)}
.mini{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:var(--white);box-shadow:0 0 0 1px rgba(16,24,40,.06);flex:none;overflow:hidden}.mini img{display:block;width:17px;height:17px;object-fit:contain}.mini.full img{width:100%;height:100%}
.bus{position:relative;display:block;width:34px;height:24px;overflow:hidden;flex:none}.tile .bus .art{position:absolute;left:-7.9px;top:-9px;width:125px;height:42px;max-width:none}
.link{display:flex;align-items:center}
.track{position:relative;flex:0 0 64px;height:2px;margin:0 10px;background:repeating-linear-gradient(90deg,var(--orange) 0 5px,transparent 5px 10px)}.track::after{content:"";position:absolute;top:-3px;left:0;width:8px;height:8px;border-radius:50%;background:var(--orange);box-shadow:0 0 0 3px var(--orange-soft);animation:ride 2.6s cubic-bezier(.65,0,.35,1) infinite alternate}
.link.done .track{background:var(--orange)}.link.done .track::after{left:calc(100% - 8px);animation:none}

/* Buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 22px;border:0;border-radius:999px;background:var(--orange);color:var(--ink);font:600 16px/1.2 var(--sans);letter-spacing:-.01em;text-decoration:none;cursor:pointer;flex:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.32),inset 0 -1px 0 rgba(122,40,8,.2),0 12px 24px -14px rgba(236,92,32,.9);transition:transform .15s var(--ease),background-color .15s,box-shadow .15s}
.btn:hover{color:var(--ink);background:#F06A31}.btn:active{transform:scale(.98)}.btn .i{width:19px;height:19px}.btn.lg{min-height:54px;font-size:17px}.btn.sm{min-height:44px;padding:0 18px;font-size:15px}.btn.sm .i{width:17px;height:17px}.btn.block{width:100%}
.btn.quiet{background:var(--mist-2);color:var(--ink);box-shadow:none}.btn.quiet:hover{background:#E9EBEE}.btn.text{min-height:44px;padding:0 4px;background:transparent;color:var(--ink-soft);box-shadow:none;font-weight:500}.btn.text:hover{color:var(--ink);background:transparent}.btn.danger{background:#FEF3F2;color:var(--danger);box-shadow:none}.btn.danger:hover{background:#FDE7E5}
.btn:disabled{transform:none}
.pill{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 14px;border:0;border-radius:999px;background:var(--mist-2);color:var(--ink);font:600 14px/1 var(--sans);text-decoration:none;cursor:pointer;flex:none;transition:background-color .15s,transform .15s var(--ease)}.pill:hover{color:var(--ink);background:#E9EBEE}.pill:active{transform:scale(.97)}.pill.lg{height:40px;padding:0 18px}.pill.on-white{background:var(--white);box-shadow:inset 0 0 0 1px var(--line)}
.ghost{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0;border:0;background:transparent;color:var(--ink-soft);font:500 15px/1.2 var(--sans);text-decoration:none;cursor:pointer}.ghost:hover{color:var(--ink)}.ghost .i{width:16px;height:16px;transition:transform .25s var(--ease)}.ghost[aria-expanded=true] .i{transform:rotate(180deg)}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:24px}

/* Copy field, stations and the live LED */
.field{display:flex;align-items:center;gap:10px;min-height:60px;padding:0 8px 0 18px;border-radius:999px;background:var(--mist)}.url{flex:1;min-width:0;overflow:hidden;font:500 14px/1.4 var(--mono);color:var(--ink);white-space:nowrap;text-overflow:ellipsis;user-select:all;-webkit-user-select:all}.url i{font-style:normal;color:#6B727D}
.route{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}.stop{position:relative;display:grid;grid-template-columns:24px minmax(0,1fr);column-gap:14px;padding-bottom:18px}.stop:last-child{padding-bottom:0}.stop::before{content:"";position:absolute;left:11px;top:24px;bottom:0;width:2px;background:var(--orange)}.stop:last-child::before{display:none}
.node{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--white);box-shadow:inset 0 0 0 2px var(--orange);font:600 11px/1 var(--mono);color:var(--ink)}.node.end{background:var(--orange);box-shadow:0 0 0 4px var(--orange-soft)}.node.end::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--ink)}
.stop p{margin:1px 0 0;font-size:16px;line-height:22px;text-wrap:pretty}.stop b{font-weight:600}.stop small{display:block;margin-top:3px;font-size:14px;line-height:19px;color:var(--muted)}.stop code{font:500 14px/1 var(--mono)}
.led{display:flex;align-items:center;gap:12px;min-height:52px;padding:0 20px;border-radius:999px;background:var(--night);box-shadow:inset 0 0 0 1px rgba(255,255,255,.07),0 14px 30px -16px rgba(13,15,17,.7);font:500 13px/1.3 var(--mono);letter-spacing:.01em;color:var(--amber);text-decoration:none;transition:background-color .3s}
.led:hover{color:var(--amber)}.led .dot{width:8px;height:8px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 3px rgba(255,180,94,.14),0 0 14px 1px rgba(255,180,94,.6);flex:none;animation:blink 1.6s ease-in-out infinite}
.led .go{display:inline-flex;align-items:center;gap:4px;margin-left:auto;color:rgba(255,255,255,.72);font:600 13px/1 var(--sans);letter-spacing:0}.led .go .i{width:15px;height:15px}
.led.on{color:#7FE0AE}.led.on:hover{color:#7FE0AE}.led.on .dot{background:#3DDC97;box-shadow:0 0 0 3px rgba(61,220,151,.16),0 0 14px 1px rgba(61,220,151,.55);animation:none}
.led.lit{animation:lit .6s var(--ease)}
.dock{display:flex;flex-direction:column;align-items:center;gap:6px;margin-top:28px}.dock.stack{align-items:stretch;gap:10px}.dock:empty{margin-top:0}
.ledwrap{margin-top:12px}
.alt{display:flex;align-items:center;justify-content:center;min-height:40px;font-size:15px;font-weight:600;text-decoration:none}

/* Message to paste, setting rows and the terminal card */
.msg{margin:22px 0 0;padding:14px 16px 16px;border-radius:22px;background:var(--mist)}.msg figcaption{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;font-size:13px;line-height:18px;font-weight:600;color:var(--ink-soft)}.msg figcaption .who{display:flex;align-items:center;gap:8px}.msg figcaption .mini{width:22px;height:22px;border-radius:7px}.msg .again{margin-top:12px}.msg .more-text{display:none}
.code{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:999px;background:var(--white);box-shadow:inset 0 0 0 1px var(--line);font:500 11px/1 var(--mono);color:var(--ink-soft);white-space:nowrap}.code .i{width:12px;height:12px}
.msg p,.msg pre{margin:0;font:500 12.5px/19px var(--mono);color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere;max-width:none}.msg p.aside{font:400 14px/20px var(--sans);color:var(--ink-soft)}.msg .url-line{display:block;margin-top:10px;font:500 12.5px/1.3 var(--mono);color:var(--action);overflow-wrap:anywhere}
.msg-acts{display:flex;gap:10px;margin-top:14px}.msg-acts .btn{flex:1}
.foot{margin:10px 0 0;font-size:13px;line-height:18px;color:var(--muted);text-align:center;max-width:none}
.setting{position:relative;display:flex;align-items:center;gap:12px;min-height:56px;margin-top:16px;padding:0 8px 0 16px;border-radius:20px;background:var(--mist);font-size:15px;line-height:20px}.setting>.i{width:18px;height:18px;color:var(--ink-soft)}.setting>.slab{flex:1}
.picker{position:relative;display:inline-flex}.picker select{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:16px}
.term{border-radius:22px;background:radial-gradient(circle at 1px 1px,rgba(255,255,255,.07) 1px,transparent 1.6px) 0 0/16px 16px,var(--night);box-shadow:0 0 0 8px var(--mist),0 0 0 9px var(--line-2),0 40px 80px -40px rgba(13,15,17,.55);overflow:hidden}
.tbar{display:flex;align-items:center;gap:14px;height:60px;padding:0 10px 0 20px;border-bottom:1px solid rgba(255,255,255,.08)}.lights{display:flex;gap:7px}.lights i{width:11px;height:11px;border-radius:50%;background:rgba(255,255,255,.16)}.ttitle{flex:1;font:500 12.5px/1 var(--mono);color:rgba(255,255,255,.6)}.tbar .btn{min-height:40px;padding:0 16px;font-size:14px}.tbar .btn .i{width:16px;height:16px}
.tbody{padding:36px 36px 48px;font:500 16px/29px var(--mono);color:rgba(255,255,255,.92);overflow-wrap:anywhere}.tbody p{margin:0;max-width:none}.pr{margin-right:10px;color:var(--amber)}.cmd{color:var(--amber)}.caret{display:inline-block;width:9px;height:18px;margin-left:4px;vertical-align:-3px;background:var(--amber);animation:caret 1.1s steps(1) infinite}
.seg{display:inline-flex;margin-top:28px;padding:4px;border-radius:999px;background:var(--mist-2)}.seg a{display:flex;align-items:center;gap:8px;height:38px;padding:0 16px 0 10px;border-radius:999px;color:var(--ink-soft);font:600 14px/1 var(--sans);text-decoration:none}.seg a:hover{color:var(--ink)}.seg a img{width:20px;height:20px;border-radius:6px}.seg a[aria-current=page]{background:var(--white);color:var(--ink);box-shadow:0 1px 2px rgba(16,24,40,.08),0 0 0 1px rgba(16,24,40,.05)}
.aux{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;margin-top:30px;font-size:15px}.aux button{padding:0;border:0;background:transparent;color:var(--action);font:600 15px/1.4 var(--sans);cursor:pointer}.aux button:hover{color:var(--action-hover)}
.help{align-self:stretch;margin-top:14px;padding:16px 18px;border-radius:18px;background:var(--mist);font-size:14px;line-height:20px;color:var(--ink-soft);text-align:left}.help ul{margin:0;padding-left:18px}.help li+li{margin-top:8px}.help pre{margin:10px 0 0;font:500 12.5px/19px var(--mono);color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere}.help a{font-weight:600}.help .flush{margin:0}.help .copybox{margin:12px 0 0;background:var(--white)}
.trip{display:flex;align-items:flex-start;margin-top:16px}.stn{display:flex;flex-direction:column;align-items:center;gap:9px;width:96px;flex:none}.ring{display:grid;place-items:center;width:52px;height:52px;border-radius:50%;background:var(--mist);color:var(--ink)}.ring.on{background:var(--orange);box-shadow:0 0 0 5px var(--orange-soft)}.ring .i{width:24px;height:24px}.stn small{font:500 11.5px/1 var(--mono);color:var(--muted);white-space:nowrap}
.line{position:relative;flex:1;height:2px;margin-top:25px;background:repeating-linear-gradient(90deg,var(--orange) 0 5px,transparent 5px 10px)}.line::after{content:"";position:absolute;top:-3px;left:0;width:8px;height:8px;border-radius:50%;background:var(--orange);box-shadow:0 0 0 3px var(--orange-soft);animation:trip 3s cubic-bezier(.65,0,.35,1) infinite}

/* Setup layouts */
.setup{max-width:560px;padding-top:12px}.setup .link{margin-top:24px}.setup .h1{margin-top:22px}.setup .field{margin-top:22px}.setup .label.steps{margin-top:32px;margin-bottom:12px}
.setup-split{display:flex;flex-wrap:wrap;align-items:flex-start;gap:56px 72px;padding-top:12px}.setup-split>.copy{flex:1 1 380px;min-width:0;max-width:500px}.setup-split>.side{flex:1.3 1 460px;min-width:0;padding-top:118px}.setup-split .link{margin-top:28px}.setup-split .h1{margin-top:28px}.setup-split .route{margin-top:32px}.setup-split .stop{grid-template-columns:26px minmax(0,1fr);column-gap:16px;padding-bottom:22px}.setup-split .stop::before{left:12px;top:26px}.setup-split .node{width:26px;height:26px;font-size:12px}.setup-split .stop p{margin-top:2px;font-size:17px;line-height:24px}.setup-split .led{margin-top:22px}

/* Home */
.board{margin-top:16px;padding:16px 16px 18px;border-radius:26px;color:var(--white);background:radial-gradient(circle at 1px 1px,rgba(255,255,255,.09) 1px,transparent 1.6px) 0 0/14px 14px,var(--night);box-shadow:0 18px 40px -26px rgba(13,15,17,.9)}
.bhead{display:flex;align-items:center;justify-content:space-between}.kicker{display:flex;align-items:center;gap:8px;margin:0;font:500 12px/1 var(--mono);color:var(--amber)}.kicker .dot{width:7px;height:7px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 3px rgba(255,180,94,.14),0 0 12px 1px rgba(255,180,94,.6);flex:none;animation:blink 1.6s ease-in-out infinite}
.board .mini{width:30px;height:30px;border-radius:9px;box-shadow:none}.board .mini img{width:20px;height:20px}.board .mini.full img{width:100%;height:100%}.board .mini.empty{background:transparent;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.35);color:rgba(255,255,255,.7)}.board .mini.empty .i{width:15px;height:15px}
.board .track{flex:0 0 40px;margin:0 7px;background:repeating-linear-gradient(90deg,var(--amber) 0 4px,transparent 4px 8px)}.board .track::after{background:var(--amber);box-shadow:0 0 10px 1px rgba(255,180,94,.7)}
.board h2{margin:14px 0 0;font:600 22px/28px var(--display);letter-spacing:-.022em}.board .sub{margin:4px 0 0;font-size:15px;line-height:21px;color:rgba(255,255,255,.74)}
.quote{display:flex;align-items:center;gap:12px;margin-top:12px;padding:12px 10px 12px 14px;border-radius:18px;background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)}.quote p{margin:0;flex:1;font-size:15px;line-height:21px;font-weight:500}
.amber{height:34px;padding:0 14px;border:0;border-radius:999px;background:var(--amber);color:var(--ink);font:600 14px/1 var(--sans);text-decoration:none;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none;transition:transform .15s var(--ease)}.amber:hover{color:var(--ink);background:#FFC07A}.amber:active{transform:scale(.97)}.board .amber.lg{height:44px;padding:0 20px;margin-top:14px;font-size:15px}
.fine{margin:10px 0 0;font-size:13px;line-height:18px;color:rgba(255,255,255,.6)}
.home .group{margin-top:14px}.home .h1{margin-top:28px}.home .board{margin-top:22px}
.notice{display:flex;align-items:center;gap:14px;margin:16px 0 0;padding:14px 14px 14px 16px;border-radius:20px;background:var(--mist);font-size:14px;line-height:20px}.notice>.i{width:18px;height:18px;color:var(--warn)}.notice>div{flex:1;min-width:0}.notice h2,.notice h3{margin:0 0 2px;font:600 15px/20px var(--sans);letter-spacing:-.01em}.notice p{margin:0;color:var(--ink-soft)}.notice.error{background:#FEF3F2}.notice.error>.i{color:var(--danger)}.notice.error p{color:var(--danger)}.notice.success>.i{color:var(--green)}.notice.warning>.i{color:var(--warn)}

/* Assistant page */
.assistant>.ahead,.assistant>.form{max-width:720px}.ahead{display:flex;align-items:center;gap:22px;margin-top:36px}.ahead .h1{overflow-wrap:anywhere}.namerow{display:flex;align-items:center;gap:10px}.namerow .ib{display:none;width:32px;height:32px}.namerow .ib .i{width:16px;height:16px}.ahead .st{margin-top:8px;font-size:15px;line-height:20px;color:var(--ink-soft)}.ahead>.pill{margin-left:auto}
.rename{display:flex;align-items:center;gap:10px;flex:1;min-width:0}.rename input{min-width:0;flex:1;height:52px;padding:0 16px;border:0;border-radius:16px;background:var(--mist);font:600 28px/1 var(--display);letter-spacing:-.03em;outline:none}.rename input:focus-visible{box-shadow:0 0 0 2px var(--orange)}
.form{margin-top:40px}.flabel{display:block;margin-bottom:10px;font-size:14px;line-height:18px;font-weight:600}
.input,.form-group input:not([type=checkbox]):not([type=radio]),.form-group textarea,.form-group select,.gate input{display:block;width:100%;min-height:54px;padding:0 18px;border:0;border-radius:16px;background:var(--mist);color:var(--ink);font:400 16px/1.4 var(--sans);outline:none;transition:box-shadow .15s}
.input:focus-visible,.form-group input:focus-visible,.form-group textarea:focus-visible,.form-group select:focus-visible,.gate input:focus-visible{box-shadow:0 0 0 2px var(--orange)}
textarea.input,.form-group textarea{min-height:120px;padding:14px 18px;resize:vertical}.form-group select{appearance:none;-webkit-appearance:none;padding-right:40px;background-image:linear-gradient(45deg,transparent 50%,var(--ink-soft) 50%),linear-gradient(135deg,var(--ink-soft) 50%,transparent 50%);background-position:calc(100% - 22px) 50%,calc(100% - 17px) 50%;background-size:5px 5px;background-repeat:no-repeat}
.hint{margin:10px 0 0;font-size:14px;line-height:20px;color:var(--muted)}
.switches{margin-top:30px}.switches .row{min-height:76px;padding:0 18px 0 20px;cursor:default}.switches .row:hover{background:transparent}.switches .row+.row::before{left:20px;right:18px}.switches .rt b{font-size:16px;line-height:21px;white-space:normal}
.switch{position:relative;width:52px;height:32px;padding:0;border:0;border-radius:999px;background:#D5D9DE;cursor:pointer;flex:none;box-shadow:inset 0 0 0 1px rgba(16,24,40,.06);transition:background-color .2s var(--ease)}.switch i{position:absolute;top:2px;left:2px;width:28px;height:28px;border-radius:50%;background:var(--white);box-shadow:0 2px 6px rgba(13,15,17,.22),0 0 0 .5px rgba(13,15,17,.06);transition:transform .25s var(--ease)}
.switch[aria-checked=true]{background:var(--orange);box-shadow:inset 0 0 0 1px rgba(122,40,8,.12)}.switch[aria-checked=true] i{transform:translateX(20px)}.switch:disabled{opacity:.6}
.adv{display:flex;align-items:center;gap:16px;width:100%;min-height:72px;margin-top:14px;padding:0 18px 0 20px;border:0;border-radius:22px;background:transparent;box-shadow:inset 0 0 0 1px var(--line-2);color:var(--ink);font:inherit;text-align:left;cursor:pointer;transition:background-color .15s}.adv:hover{background:rgba(23,25,27,.02)}.adv .rt b{font-size:16px;line-height:21px}.adv .chev{transition:transform .25s var(--ease)}.adv[aria-expanded=true] .chev{transform:rotate(180deg)}
.advanced{padding:10px 4px 0}.advanced h2{margin:30px 0 4px;font:600 16px/21px var(--sans);letter-spacing:-.01em}.advanced h2:first-child{margin-top:18px}.advanced>p{margin:0 0 12px;font-size:14px;line-height:20px;color:var(--muted)}
.checks{display:flex;flex-direction:column;border-radius:20px;background:var(--mist)}.checks label{position:relative;display:flex;align-items:center;gap:12px;min-height:52px;padding:0 16px;font-size:15px;cursor:pointer}.checks label+label::before{content:"";position:absolute;top:0;left:48px;right:16px;height:1px;background:var(--line)}.checks .who{display:flex;flex-direction:column;gap:1px;padding:8px 0}.checks .who small{color:var(--muted);font-size:13px;line-height:17px}
.checks input,.check-row input{appearance:none;-webkit-appearance:none;display:grid;place-items:center;width:20px;height:20px;margin:0;border-radius:6px;background:var(--white);box-shadow:inset 0 0 0 1.5px var(--strong);flex:none;cursor:pointer;transition:background-color .15s,box-shadow .15s}.checks input:checked,.check-row input:checked{background:var(--orange);box-shadow:inset 0 0 0 1.5px var(--orange)}.checks input:checked::after,.check-row input:checked::after{content:"";width:9px;height:5px;margin-top:-2px;border-left:2px solid var(--ink);border-bottom:2px solid var(--ink);transform:rotate(-45deg)}.checks input:disabled{opacity:.5}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0}.chips button{display:inline-flex;align-items:center;gap:6px;min-height:38px;padding:0 14px;border:0;border-radius:999px;background:var(--mist-2);color:var(--muted);font:500 14px/1 var(--sans);cursor:pointer;transition:background-color .15s,color .15s,box-shadow .15s}.chips button:hover{color:var(--ink)}.chips button[aria-pressed=true]{background:#FFF1EA;color:var(--ink);box-shadow:inset 0 0 0 1.5px rgba(236,92,32,.5)}.chips button .i{width:14px;height:14px;color:var(--orange);stroke-width:2.2}
.advanced>.chip-label{margin:22px 0 0;font-size:13px;font-weight:600;color:var(--ink-soft)}
.danger-zone{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
.idline{margin:16px 0 0;font:500 12.5px/1.6 var(--mono);color:var(--muted);overflow-wrap:anywhere}

/* Existing pages: activity, conversations, settings */
.agent-list{display:flex;flex-direction:column;border-radius:22px;background:var(--mist);overflow:hidden}.agent-list:empty{display:none}
.activity-row{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 18px;align-items:center;padding:16px 18px;color:var(--ink);text-decoration:none;transition:background-color .15s}.activity-row:hover{color:var(--ink);background:rgba(23,25,27,.03)}.activity-row+.activity-row::before{content:"";position:absolute;top:0;left:18px;right:18px;height:1px;background:var(--line)}.activity-row strong{font-size:16px;font-weight:600;letter-spacing:-.01em}.activity-row p{margin:3px 0 0;font-size:14px;color:var(--muted)}.activity-row time{font-size:13px;color:var(--muted)}.activity-row .status{grid-column:1/-1}
.status{display:inline-flex;align-items:center;gap:7px;color:var(--muted);font-size:13px;white-space:nowrap}.status::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}.status.good{color:var(--green-text)}.status.pending{color:var(--warn-text)}.status.failed{color:var(--danger)}
.chips[aria-label]{margin:8px 0 20px}.chips[aria-label] button{min-height:40px;box-shadow:none}
.empty-state .btn.quiet,.notice .btn.quiet{background:var(--white);box-shadow:inset 0 0 0 1px var(--line)}
.empty-state{padding:28px 24px;border-radius:22px;background:var(--mist)}.empty-state h2{margin:0 0 8px;font:600 22px/28px var(--display);letter-spacing:-.02em}.empty-state p{color:var(--ink-soft)}
.reading{max-width:720px}.status-summary{padding:20px 22px;border-radius:22px;background:var(--mist)}.status-summary h3{margin:0 0 6px;font:600 17px/22px var(--sans)}.status-summary p{margin:0;font-size:15px;color:var(--ink-soft)}
.message{padding:20px 0;border-bottom:1px solid var(--line)}.message-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;font-size:14px}.message-head time{font-size:13px;color:var(--muted)}.message-body{font-size:15px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
.form-section{margin-top:32px;padding-top:28px;border-top:1px solid var(--line)}.form-section h2{margin-bottom:8px;font:600 20px/26px var(--display);letter-spacing:-.02em}.form-section>p{margin-bottom:18px;font-size:15px;color:var(--ink-soft)}
.form-group{margin-bottom:22px}.form-group>label,.field-label{display:block;margin-bottom:10px;font-size:14px;font-weight:600}.form-group p{margin:8px 0 0;font-size:14px;color:var(--muted)}
.check-row{display:flex;align-items:flex-start;gap:12px;margin:14px 0}.check-row input{margin-top:2px}.check-row strong{display:block;font-size:15px;font-weight:600}.check-row small{display:block;margin-top:2px;color:var(--muted)}
.copybox{margin:18px 0;padding:14px 16px 16px;border-radius:20px;background:var(--mist)}.copytop{display:flex;align-items:center;justify-content:space-between;gap:12px}.copytop strong{font-size:13px;font-weight:600;color:var(--ink-soft)}.copybox pre{margin:12px 0 0;font:500 12.5px/19px var(--mono);white-space:pre-wrap;overflow-wrap:anywhere}.copytop .btn{min-height:36px;padding:0 14px;font-size:14px;box-shadow:none}
details{margin-top:18px;border-top:1px solid var(--line);padding-top:12px}summary{display:list-item;min-height:44px;padding:10px 0;font-size:15px;font-weight:600;cursor:pointer}details p,details li{font-size:14px;color:var(--ink-soft)}
.plain-list{padding-left:20px;font-size:14px;color:var(--ink-soft)}.plain-list li{margin-bottom:8px}
.footnote{display:flex;align-items:flex-start;gap:10px;margin:24px 0 0;font-size:13px;line-height:19px;color:var(--muted)}.footnote .i{width:16px;height:16px;margin-top:1px}
.split{display:grid;grid-template-columns:minmax(0,660px) 220px;gap:48px}.aside-note{padding-top:8px;font-size:14px;color:var(--muted)}.aside-note h3{margin:0 0 8px;font:600 15px/20px var(--sans);color:var(--ink)}
.inline-fields{display:grid;grid-template-columns:1fr 1fr;gap:18px}.choice-group{margin:0 0 24px;padding:0;border:0}.choice-group legend{margin-bottom:10px;font-size:14px;font-weight:600}
.error-text{margin:14px 0 0;font-size:14px;color:var(--danger)}.code-key{font:500 12.5px/1.6 var(--mono);overflow-wrap:anywhere}.tag{margin-left:8px;padding:3px 8px;border-radius:999px;background:var(--mist-2);font-size:12px;font-weight:500;color:var(--ink-soft)}
.toast{position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));z-index:30;max-width:min(560px,calc(100% - 32px));padding:12px 18px;border-radius:16px;background:var(--night);color:var(--white);font-size:14px;line-height:20px;box-shadow:0 18px 40px -18px rgba(13,15,17,.6);transform:translateX(-50%)}
.skeleton{height:18px;max-width:270px;margin:18px 0;border-radius:8px;background:linear-gradient(90deg,#EEF0F3,#F6F7F9,#EEF0F3);background-size:200% 100%;animation:shimmer 1.4s linear infinite}.skeleton.short{max-width:160px}.loading-title{height:44px;max-width:340px;margin-top:28px}.skeleton-row{display:flex;align-items:center;gap:14px;padding:14px 0}.skeleton-row .skeleton{margin:0;flex:1}.skeleton-row .skeleton.short{flex:0 0 120px}
.gate{max-width:420px;margin:14vh auto;padding:24px}.gate h1{margin:28px 0 14px;font:600 36px/40px var(--display);letter-spacing:-.034em}.gate .btn{width:100%;margin-top:8px}.gate .brand-text{display:inline-block}
.draft-reminder{margin-top:12px}

@keyframes ride{to{left:calc(100% - 8px)}}@keyframes trip{0%{left:0;opacity:0}12%{opacity:1}88%{opacity:1}100%{left:calc(100% - 8px);opacity:0}}@keyframes blink{50%{opacity:.28}}@keyframes caret{50%{opacity:0}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes shimmer{to{background-position:-200% 0}}@keyframes lit{0%{transform:scale(.97)}60%{transform:scale(1.015)}100%{transform:none}}@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.main.enter>*{animation:rise .35s var(--ease) both}
.form-section.first{margin-top:0;padding-top:0;border-top:0}
`;

const PHONE_CSS = `
@media (max-width:899px){
.shell{display:block;min-height:100vh;min-height:100svh;background:var(--white)}
.sidebar{display:none}
.mtop{display:flex;align-items:center;justify-content:space-between;height:44px;margin-top:max(10px,env(safe-area-inset-top));padding:0 max(16px,env(safe-area-inset-right)) 0 max(16px,env(safe-area-inset-left))}
.mtop .mbrand{display:block;width:96px;height:32px;margin-left:-2px}.mtop .mbrand img{display:block;width:96px;height:32px}.mtop .av{width:36px;height:36px;font-size:14px}.mtop .av .i{width:18px;height:18px}
.pane{margin:0;border-radius:0;box-shadow:none;background:transparent}
.main{min-height:0;max-width:600px;margin:0 auto;padding:0 max(20px,env(safe-area-inset-right)) calc(40px + env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left))}
body.tabbed .main{padding-bottom:var(--tabs-space)}
body.tabbed .tabs{position:fixed;left:max(20px,env(safe-area-inset-left));right:max(20px,env(safe-area-inset-right));bottom:calc(26px + env(safe-area-inset-bottom));z-index:10;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));height:64px;max-width:560px;margin:0 auto;padding:6px;border-radius:999px;background:rgba(255,255,255,.8);-webkit-backdrop-filter:blur(24px) saturate(1.8);backdrop-filter:blur(24px) saturate(1.8);box-shadow:inset 0 0 0 1px rgba(16,24,40,.07),0 18px 36px -20px rgba(16,24,40,.5)}
.tabs a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border-radius:999px;color:var(--muted);font-size:11px;line-height:13px;font-weight:600;text-decoration:none;transition:background-color .2s,color .2s}.tabs a .i{width:22px;height:22px}.tabs a[aria-current=page]{background:rgba(23,25,27,.06);color:var(--ink)}
body.flow .mtop{display:none}
.flowtop{display:flex;align-items:center;height:44px;margin-top:max(10px,env(safe-area-inset-top));margin-left:-4px}
.deskback{display:none}
.navigation-error{margin:8px 16px 0}
.h1,.page-head h1{font-size:32px;line-height:36px;letter-spacing:-.032em}.lead,.page-head p{margin-top:10px;font-size:16px;line-height:23px}
.page-head{display:block;margin:14px 0 24px}.head-action{margin-top:18px}
.chooser .h1{margin-top:28px}.chooser .label{margin-top:32px}.chooser .label+.group{margin-top:0}.chooser .label.second{margin-top:28px}
.home .h1{margin-top:14px;font-size:34px;line-height:40px;letter-spacing:-.034em}.home .row{min-height:66px}
.setup{display:flex;flex-direction:column;min-height:calc(100vh - 40px - env(safe-area-inset-bottom));min-height:calc(100svh - 40px - env(safe-area-inset-bottom));padding-top:0}.setup>.flowtop{flex:none}.setup .link{margin-top:18px}
.setup .dock{margin-top:auto;padding-top:28px}.setup .dock.stack{padding-top:24px}
.setup .ledwrap{position:sticky;bottom:calc(16px + env(safe-area-inset-bottom));z-index:5;margin-top:6px}.setup .ledwrap::before{content:"";position:absolute;z-index:-1;left:-20px;right:-20px;top:-28px;bottom:calc(-16px - env(safe-area-inset-bottom));background:linear-gradient(rgba(255,255,255,0),#fff 28px);pointer-events:none}
.home .h1{margin-top:14px}.home .board{margin-top:16px}
.setup-split{display:block;padding-top:0}.setup-split>.side{padding-top:0;margin-top:28px}.setup-split .h1{margin-top:22px}.setup-split .stop{grid-template-columns:24px minmax(0,1fr);column-gap:14px;padding-bottom:18px}.setup-split .stop::before{left:11px;top:24px}.setup-split .node{width:24px;height:24px;font-size:11px}.setup-split .stop p{margin-top:1px;font-size:16px;line-height:22px}
.term{box-shadow:0 0 0 6px var(--mist),0 0 0 7px var(--line-2)}.tbody{padding:22px 20px 28px;font-size:13.5px;line-height:23px}.tbar{height:54px;padding-left:16px}
.ahead{gap:16px;margin-top:20px}.ahead .h1{font-size:32px;line-height:36px}.ahead>.pill{display:none}.namerow .ib{display:grid}.ahead .st{font-size:14px}
.msg .clamp{max-height:171px;overflow:hidden;-webkit-mask-image:linear-gradient(#000 60%,transparent);mask-image:linear-gradient(#000 60%,transparent)}.msg .more-text{display:inline-flex;margin-top:6px;padding:0;border:0;background:transparent;color:var(--action);font:600 13px/1.4 var(--sans);cursor:pointer}.tile.xl{width:60px;height:60px;border-radius:18px}.tile.xl img{width:38px;height:38px}
.form{margin-top:28px}.switches .row{padding:14px 16px;min-height:76px}
.split,.inline-fields{grid-template-columns:minmax(0,1fr);gap:16px}
.activity-row{padding:14px 16px}
.gate{margin:10vh auto}
}
@media (min-width:900px){.flowtop,.mback{display:none}body.flow .tabs{display:none}}
@media (min-width:1500px){.main{padding-left:72px;padding-right:72px}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;

export const WORKSPACE_CSS = SHELL_CSS + PHONE_CSS;
