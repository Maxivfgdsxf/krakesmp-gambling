import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
Deno.serve(async (req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:{...cors,"Content-Type":"application/json"}});
  const url=Deno.env.get("SUPABASE_URL")!;
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin=createClient(url,key,{auth:{persistSession:false}});
  const auth=req.headers.get("Authorization")?.replace(/^Bearer\\s+/i,"");
  const {data,error}=auth?await admin.auth.getUser(auth):{data:{user:null},error:new Error("No session")};
  if(error||!data.user) return new Response(JSON.stringify({error:"Unauthorized"}),{status:401,headers:{...cors,"Content-Type":"application/json"}});
  return new Response(JSON.stringify({error:"Use the whitelisted public.admin_command RPC. Direct legacy admin actions are disabled."}),{status:410,headers:{...cors,"Content-Type":"application/json"}});
});
