import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import './styles.css';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const db = url && key ? createClient(url, key) : null;
type Profile = { id: string; username: string; display_name: string; bio: string; is_private: boolean };
type Post = { id: string; author_id: string; body: string; created_at: string; profiles: { display_name: string; username: string } | null; likes: { user_id: string }[] };
type Comment = { id: string; body: string; profiles: { display_name: string } | null };
const text = {
  ar: { brand:'راوي', subtitle:'شبكة اجتماعية للحكايات والمحادثات', language:'English', theme:'تبديل المظهر', login:'تسجيل الدخول', signup:'إنشاء حساب', logout:'تسجيل الخروج', email:'البريد الإلكتروني', password:'كلمة المرور', checkEmail:'تحقّق من بريدك لتأكيد الحساب.', profile:'أكمل ملفك الشخصي', username:'اسم المستخدم (حروف إنجليزية صغيرة أو أرقام أو شرطة سفلية)', name:'الاسم الظاهر', bio:'نبذة', private:'حساب خاص', save:'حفظ', feed:'آخر المنشورات', compose:'ماذا تريد أن تشارك؟', publish:'انشر', none:'لا توجد منشورات بعد.', load:'جارٍ التحميل…', more:'عرض المزيد', like:'إعجاب', unlike:'إلغاء الإعجاب', comments:'التعليقات', comment:'اكتب تعليقًا', send:'إرسال', remove:'احذف المنشور', confirmRemove:'هل تريد حذف هذا المنشور؟', missing:'لم يتم ضبط اتصال Supabase لهذا الإصدار.', failed:'تعذّر إكمال العملية. تحقّق من بياناتك وحاول مجددًا.' },
  en: { brand:'Rawi', subtitle:'A social network for stories and conversations', language:'العربية', theme:'Toggle theme', login:'Sign in', signup:'Create account', logout:'Sign out', email:'Email', password:'Password', checkEmail:'Check your email to confirm your account.', profile:'Set up your profile', username:'Username (lowercase letters, digits or underscores)', name:'Display name', bio:'Bio', private:'Private account', save:'Save', feed:'Latest posts', compose:'What would you like to share?', publish:'Publish', none:'No posts yet.', load:'Loading…', more:'Show more', like:'Like', unlike:'Unlike', comments:'Comments', comment:'Write a comment', send:'Send', remove:'Delete post', confirmRemove:'Delete this post?', missing:'Supabase is not configured for this build.', failed:'Could not complete the request. Check your details and try again.' }
} as const;
type Lang = keyof typeof text;
const pageSize = 12;
const postFields = 'id,author_id,body,created_at,profiles(display_name,username),likes(user_id)';

function App() {
  const [lang,setLang] = useState<Lang>(() => localStorage.getItem('rawi-lang') === 'en' ? 'en' : 'ar');
  const [dark,setDark] = useState(() => localStorage.getItem('rawi-theme') ? localStorage.getItem('rawi-theme') === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  const t = text[lang];
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'; document.title = t.brand; localStorage.setItem('rawi-lang',lang); },[lang,t.brand]);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('rawi-theme',dark ? 'dark' : 'light'); },[dark]);
  return <><header><div className="identity"><span className="mark" aria-hidden="true">ر</span><strong>{t.brand}</strong></div><div className="actions"><button className="secondary" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{t.language}</button><button className="secondary" onClick={() => setDark(!dark)} aria-pressed={dark}>{t.theme}</button></div></header><main>{db ? <Network client={db} lang={lang} /> : <p className="panel" role="status">{t.missing}</p>}</main></>;
}

function Network({client,lang}:{client:SupabaseClient,lang:Lang}) {
  const t = text[lang];
  const [session,setSession] = useState<Session|null>(null);
  const [ready,setReady] = useState(false);
  const [profile,setProfile] = useState<Profile|null>(null);
  const [profileReady,setProfileReady] = useState(false);
  const [profileError,setProfileError] = useState(false);
  const [signup,setSignup] = useState(false);
  const [pending,setPending] = useState(false);
  const [status,setStatus] = useState<'failed'|'checkEmail'|null>(null);
  const userId = session?.user.id;
  useEffect(() => {
    const { data: { subscription } } = client.auth.onAuthStateChange((_event,next) => {
      setSession(next);setReady(true);
    });
    return () => subscription.unsubscribe();
  },[client]);
  useEffect(() => {
    let active = true;
    setProfile(null);setProfileReady(false);setProfileError(false);
    if (userId) void client.from('profiles').select('id,username,display_name,bio,is_private').eq('id',userId).maybeSingle().then(({data,error}) => {
      if (!active) return;
      setProfile(data as Profile|null);setProfileError(Boolean(error));setProfileReady(true);
    });
    return () => {active=false;};
  },[userId,client]);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget); const email = String(f.get('email')).trim(); const password = String(f.get('password'));
    setPending(true);setStatus(null);
    try {const response = signup ? await client.auth.signUp({email,password}) : await client.auth.signInWithPassword({email,password});
      if (response.error) setStatus('failed'); else if (signup && !response.data.session) setStatus('checkEmail');
    } catch {setStatus('failed');} finally {setPending(false);}
  }
  async function createProfile(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!userId) return; const f = new FormData(event.currentTarget);setPending(true);setStatus(null);
    const row = {id:userId,username:String(f.get('username')).trim(),display_name:String(f.get('name')).trim(),bio:String(f.get('bio')).trim(),is_private:f.has('private')};
    try {const {error} = await client.from('profiles').insert(row); if(error) setStatus('failed'); else setProfile(row);} catch {setStatus('failed');} finally {setPending(false);}
  }
  if (!ready) return <p role="status">{t.load}</p>;
  if (!session) return <section className="panel"><p className="small">{t.subtitle}</p><h1>{signup?t.signup:t.login}</h1><form onSubmit={submit}><label>{t.email}<input autoComplete="email" name="email" type="email" required maxLength={254}/></label><label>{t.password}<input type="password" name="password" required minLength={signup?8:1} maxLength={72} autoComplete={signup?'new-password':'current-password'}/></label><button disabled={pending}>{signup?t.signup:t.login}</button></form>{status&&<p role="status">{t[status]}</p>}<button className="secondary" disabled={pending} onClick={() => {setSignup(!signup);setStatus(null);}}>{signup?t.login:t.signup}</button></section>;
  async function signOut(){setStatus(null); const {error}=await client.auth.signOut(); if(error) setStatus('failed');}
  return <><div className="account"><span>{profile?.id === userId ? profile?.display_name : ''}</span><button className="secondary" onClick={() => void signOut()}>{t.logout}</button></div>{status&&<p role="status">{t[status]}</p>}{!profileReady ? <p role="status">{t.load}</p> : profileError ? <p role="alert">{t.failed}</p> : profile && profile.id===userId ? <Feed key={profile.id} client={client} profile={profile} lang={lang}/> : <section className="panel"><h1>{t.profile}</h1><form onSubmit={createProfile}><label>{t.username}<input name="username" pattern="[a-z0-9_]{3,30}" minLength={3} maxLength={30} dir="ltr" required/></label><label>{t.name}<input name="name" maxLength={80} required/></label><label>{t.bio}<textarea name="bio" maxLength={500}/></label><label className="check"><input name="private" type="checkbox"/>{t.private}</label><button disabled={pending}>{t.save}</button></form></section>}</>;
}

function Feed({client,profile,lang}:{client:SupabaseClient,profile:Profile,lang:Lang}) {
  const t=text[lang]; const [posts,setPosts]=useState<Post[]>([]); const [hasMore,setHasMore]=useState(false);const [fetching,setFetching]=useState(true); const [error,setError]=useState(false); const [busy,setBusy]=useState(false); const revision=useRef(0);
  async function fetchPosts(after?: Post) {
    const request = ++revision.current;setFetching(true);setError(false);
    let query=client.from('posts').select(postFields).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(pageSize+1);
    if(after) query=query.or(`created_at.lt.${after.created_at},and(created_at.eq.${after.created_at},id.lt.${after.id})`);
    try {const {data,error:err}=await query; if(request!==revision.current) return; if(err){setError(true);return;} const rows=(data??[]) as unknown as Post[];setHasMore(rows.length>pageSize);setPosts(previous=>after?[...previous,...rows.slice(0,pageSize)]:rows.slice(0,pageSize));}
    catch {if(request===revision.current)setError(true);} finally {if(request===revision.current)setFetching(false);}
  }
  useEffect(() => {void fetchPosts();return () => {revision.current++;};},[client]);
  async function publish(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;const body=String(new FormData(form).get('body')).trim();if(!body)return;setBusy(true);setError(false);try{const {error:err}=await client.from('posts').insert({body});if(err){setError(true);return;}form.reset();await fetchPosts();}catch{setError(true);}finally{setBusy(false);}}
  return <><section className="panel"><h1>{t.feed}</h1><form onSubmit={publish}><label>{t.compose}<textarea name="body" maxLength={2000} dir="auto" required/></label><button disabled={busy}>{t.publish}</button></form></section>{error&&<p role="alert">{t.failed}</p>}{fetching&&<p role="status">{t.load}</p>}{!fetching&&!posts.length&&!error&&<p className="panel">{t.none}</p>}<div className="stream">{posts.map(post=><PostCard key={post.id} post={post} client={client} profile={profile} lang={lang} removed={()=>setPosts(rows=>rows.filter(p=>p.id!==post.id))}/>)}</div>{hasMore&&<button className="secondary" disabled={fetching} onClick={()=>void fetchPosts(posts.at(-1))}>{t.more}</button>}</>;
}

function PostCard({post,client,profile,lang,removed}:{post:Post;client:SupabaseClient;profile:Profile;lang:Lang;removed:()=>void}){
  const t=text[lang];const serverLiked=post.likes.some(l=>l.user_id===profile.id);const [override,setOverride]=useState<boolean|null>(null);const liked=override??serverLiked;const [open,setOpen]=useState(false);const [rows,setRows]=useState<Comment[]>([]);const [busy,setBusy]=useState(false);const [error,setError]=useState(false);
  async function action(run:()=>Promise<void>){setBusy(true);setError(false);try{await run();}catch{setError(true);}finally{setBusy(false);}}
  async function loadComments(){const {data,error:err}=await client.from('comments').select('id,body,profiles(display_name)').eq('post_id',post.id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(50);if(err)throw err;setRows(((data??[]) as unknown as Comment[]).reverse());}
  return <article className="panel post"><div className="byline"><b>{post.profiles?.display_name}</b><span dir="ltr">@{post.profiles?.username}</span><time dateTime={post.created_at}>{new Date(post.created_at).toLocaleString(lang,{dateStyle:'medium',timeStyle:'short'})}</time></div><p dir="auto" className="body">{post.body}</p><div className="actions"><button className="secondary" disabled={busy} aria-pressed={liked} onClick={()=>void action(async()=>{const {error:err}=liked?await client.from('likes').delete().eq('post_id',post.id).eq('user_id',profile.id):await client.from('likes').insert({post_id:post.id});if(err)throw err;setOverride(!liked);})}>{liked?t.unlike:t.like} · {Math.max(0,post.likes.length+Number(liked)-Number(serverLiked)).toLocaleString(lang)}</button><button className="secondary" aria-expanded={open} disabled={busy} onClick={()=>{if(open)setOpen(false);else void action(async()=>{await loadComments();setOpen(true);});}}>{t.comments}</button>{post.author_id===profile.id&&<button className="secondary" disabled={busy} onClick={()=>{if(confirm(t.confirmRemove)) void action(async()=>{const {error:err}=await client.from('posts').delete().eq('id',post.id);if(err)throw err;removed();});}}>{t.remove}</button>}</div>{open&&<div>{rows.map(row=><p className="comment" key={row.id}><b>{row.profiles?.display_name}</b> <span dir="auto">{row.body}</span></p>)}<form onSubmit={event=>{event.preventDefault();const form=event.currentTarget;const body=String(new FormData(form).get('body')).trim();if(body)void action(async()=>{const {error:err}=await client.from('comments').insert({post_id:post.id,body});if(err)throw err;form.reset();await loadComments();});}}><label>{t.comment}<textarea name="body" dir="auto" maxLength={1000} required/></label><button disabled={busy}>{t.send}</button></form></div>}{error&&<p role="alert">{t.failed}</p>}</article>;
}

const root=document.getElementById('root');if(root)createRoot(root).render(<App/>);
