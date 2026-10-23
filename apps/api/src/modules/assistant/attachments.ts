import {Errors} from '../../lib/errors.js';
export type Attachment={name:string;mime:string;bytes:Buffer};
const types:Record<string,string>={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',txt:'text/plain',csv:'text/csv',tsv:'text/tab-separated-values',md:'text/markdown',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
export function validateAttachment(name:string,bytes:Buffer):Attachment{
 const safe=name.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g,'').slice(-120),ext=safe.split('.').pop()!.toLowerCase(),mime=types[ext];
 if(!mime||!bytes.length||bytes.length>5*1024*1024)throw Errors.validation('Supported: PDF, PNG, JPEG, WebP, TXT, CSV, TSV, MD, XLSX, DOCX. Maximum 5 MB per file.');
 const valid=ext==='pdf'?bytes.subarray(0,5).toString()==='%PDF-':ext==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):['jpg','jpeg'].includes(ext)?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:ext==='webp'?bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP':['xlsx','docx'].includes(ext)?bytes.subarray(0,4).equals(Buffer.from([80,75,3,4])):!bytes.includes(0)&&bytes.length<=256*1024;
 if(!valid)throw Errors.validation('File contents do not match the extension, or the text file exceeds 256 KB.');
 if(mime.startsWith('text/')){try{new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw Errors.validation('Text files must use UTF-8 encoding.')}}
 return {name:safe,mime,bytes};
}
export function attachmentContent(file:Attachment){const data=`data:${file.mime};base64,${file.bytes.toString('base64')}`;if(file.mime.startsWith('image/'))return {type:'input_image',image_url:data,detail:'auto'};return {type:'input_file',filename:file.name,file_data:data};}
