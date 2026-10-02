import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('.impeccable/mocks/task-status/v3');
const routes=new Map([
 ['/',[path.join(root,'index.html'),'text/html; charset=utf-8']],
 ['/cockpit.png',[path.resolve('.impeccable/review/task-status/empty-windows.png'),'image/png']],
]);
const server=createServer(async(request,response)=>{
 const route=routes.get(new URL(request.url,'http://localhost').pathname);
 if(!route){response.writeHead(404);response.end();return;}
 try{const data=await readFile(route[0]);response.writeHead(200,{'Content-Type':route[1],'Cache-Control':'no-store'});response.end(data);}
 catch{response.writeHead(500);response.end('Design preview source unavailable');}
});
server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}/`));
