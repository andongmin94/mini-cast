import type { WebContents } from "electron";
import { readFileSync } from "node:fs";

export async function verifyAnnotationExportRendering(contents: WebContents) {
  const source = ["errors", "primitive-frame", "rotation", "text", "history", "shape-geometry", "render-plan", "canvas-renderer", "export", "export-renderer"]
    .map(name => readFileSync(new URL(`../../annotation/${name}.js`, import.meta.url), "utf8")
      .replace(/^import .* from ["'][^"']+["'];?\r?\n/gm, "").replace(/^export /gm, ""))
    .join("\n");
  return contents.executeJavaScript(`(async () => {
    ${source}
    let comparisons = 0;
    const ratios = [1, 1.25, 1.5, 2, 2.5];
    const decode = async blob => {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d', {willReadFrequently:true}); context.drawImage(bitmap, 0, 0); bitmap.close();
      const data = context.getImageData(0,0,canvas.width,canvas.height).data;
      canvas.width=canvas.height=0; return data;
    };
    for (const scale of ratios) {
      const reference=document.createElement('canvas'); reference.width=Math.round(160*scale); reference.height=Math.round(120*scale);
      const context=reference.getContext('2d',{willReadFrequently:true});
      const rect={id:'box',tool:'rectangle',color:'#FF0000',fill:'#12AB34',width:2,opacity:1,points:[{x:10,y:10},{x:60,y:10},{x:10,y:50}]};
      const translucent={id:'marker',tool:'highlighter',color:'#FFD60A',width:8,opacity:0.35,points:[{x:10,y:90},{x:140,y:90}]};
      const text=createTextElement(context,'text',{text:'한글 ABC',fontSize:18},{x:75,y:25},'#1478AF');
      const ellipse={id:'ellipse',tool:'ellipse',color:'#007AFF',fill:'#ABCDEF',width:3,opacity:1,points:[{x:75,y:55},{x:145,y:65},{x:85,y:80}]};
      const elements=[rect,translucent,rotateAnnotationElement(text,{x:110,y:50},0.18),ellipse];
      const snapshot={displayId:1,revision:12,viewport:{width:160,height:120},elements};
      const before=JSON.stringify(snapshot);
      const bytes=await renderAnnotationPng(document,snapshot,scale);
      if(JSON.stringify(snapshot)!==before) throw new Error('Export mutated the source');
      context.setTransform(scale,0,0,scale,0,0); elements.forEach(element=>drawAnnotationElement(context,element));
      const expectedBlob=await new Promise(resolve=>reference.toBlob(resolve,'image/png'));
      const expected=await decode(expectedBlob),actual=await decode(new Blob([bytes],{type:'image/png'}));
      if(actual.length!==expected.length) throw new Error('Export dimensions changed');
      for(let i=0;i<actual.length;i++) if(actual[i]!==expected[i]) throw new Error('PNG round-trip reference differs at channel '+i+' scale '+scale);
      const pixel=(x,y)=>Array.from(actual.slice(4*(Math.floor(y*scale)*reference.width+Math.floor(x*scale)),4*(Math.floor(y*scale)*reference.width+Math.floor(x*scale))+4));
      if(JSON.stringify(pixel(25,25))!==JSON.stringify([18,171,52,255])) throw new Error('Filled RGB not preserved');
      if(pixel(155,110)[3]!==0) throw new Error('Background is not transparent');
      if(pixel(20,90)[3]<80||pixel(20,90)[3]>100) throw new Error('Highlighter alpha not preserved');
      comparisons++;
      reference.width=reference.height=0;
    }
    return {comparisons,ratios,transparent:true,filledRgb:true,highlighterAlpha:true,text:true};
  })()`);
}
