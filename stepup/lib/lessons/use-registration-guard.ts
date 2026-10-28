"use client";
import {useEffect,useRef} from 'react';
/** Warns only about unsaved edits, including pending list/caption text. Never writes while leaving. */
export function useRegistrationGuard(signature:string){
 const baseline=useRef(signature),current=useRef(signature),dirtyInput=useRef(false),allow=useRef(false),restoring=useRef(false);
 useEffect(()=>{current.current=signature;if(signature!==baseline.current)allow.current=false;},[signature]);
 useEffect(()=>{
  const dirty=()=>!allow.current&&(dirtyInput.current||current.current!==baseline.current);
  const confirm=()=>!dirty()||window.confirm('Tenés cambios sin guardar. ¿Querés salir y descartarlos?');
  const input=()=>{dirtyInput.current=true;allow.current=false;};
  const before=(event:BeforeUnloadEvent)=>{if(dirty()){event.preventDefault();event.returnValue='';}};
  const click=(event:MouseEvent)=>{const el=event.target instanceof Element?event.target:null;const link=el?.closest('a[href]') as HTMLAnchorElement|null;const signOut=el?.closest('button')?.textContent?.trim()==='Cerrar sesión';if((link&&link.href!==window.location.href&&!link.hash||signOut)&&!confirm()){event.preventDefault();event.stopImmediatePropagation();}};
  const pop=(event:PopStateEvent)=>{if(restoring.current){restoring.current=false;return;}if(!confirm()){event.stopImmediatePropagation();restoring.current=true;history.forward();}};
  document.addEventListener('input',input,true);document.addEventListener('change',input,true);document.addEventListener('click',click,true);window.addEventListener('beforeunload',before);window.addEventListener('popstate',pop,true);
  return()=>{document.removeEventListener('input',input,true);document.removeEventListener('change',input,true);document.removeEventListener('click',click,true);window.removeEventListener('beforeunload',before);window.removeEventListener('popstate',pop,true);};
 },[]);
 return ()=>{baseline.current=current.current;dirtyInput.current=false;allow.current=true;};
}
