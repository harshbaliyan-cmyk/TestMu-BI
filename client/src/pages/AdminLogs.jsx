import {useEffect,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import api from '../lib/api';
import ThemeToggle from '../components/ThemeToggle';

export default function AdminLogs(){
  const navigate=useNavigate(); const [type,setType]=useState('audit'); const [items,setItems]=useState([]); const [error,setError]=useState('');
  const load=()=>api.get('/admin/logs',{params:{type,limit:200}}).then(({data})=>setItems(data.items||[])).catch(e=>setError(e.response?.data?.error||e.message));
  useEffect(()=>{load();},[type]);
  return <div className="wrap"><div className="top-nav" style={{margin:'-18px -18px 18px'}}>
    <div className="brand"><img className="brand-logo" src="/testmu-bi-logo-v3.png" alt="TestMu BI"/><span>Administration</span></div>
    <div className="user-pill"><ThemeToggle/><button className="btn-secondary" onClick={()=>navigate('/gallery')}>Back</button></div></div>
    <div className="gallery-header"><h2>Audit and error log</h2><div style={{display:'flex',gap:8}}>
      <button className={type==='audit'?'btn-primary':'btn-secondary'} onClick={()=>setType('audit')}>Audit</button>
      <button className={type==='errors'?'btn-primary':'btn-secondary'} onClick={()=>setType('errors')}>Errors</button>
      <button className="btn-secondary" onClick={async()=>{if(window.confirm('Remove logs older than 90 days?')){await api.post('/admin/retention-cleanup',{days:90});load();}}}>Clean 90+ days</button>
    </div></div>{error&&<div className="card" style={{color:'var(--red)'}}>{error}</div>}
    <div className="card"><div className="scroll"><table><thead><tr><th>Time</th><th>User / route</th><th>Action / code</th><th>Entity / message</th></tr></thead>
      <tbody>{items.map(item=><tr key={item.id}><td>{new Date(item.createdAt).toLocaleString()}</td><td>{item.email||item.route||'System'}</td>
        <td>{item.action||item.errorCode||'Error'}</td><td>{item.entityType||item.message||'—'}</td></tr>)}
      {!items.length&&<tr><td colSpan="4">No records.</td></tr>}</tbody></table></div></div></div>;
}
