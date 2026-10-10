import { protectMutation, requireAdmin } from '../../_lib/auth.js';
import { json, randomId, readJson, safeErrorResponse } from '../../_lib/http.js';
import { ensureStorefrontTables, availablePackages, validImageUrl } from '../../_lib/storefront.js';

function normalizePackage(body) {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0,110):'';
  const description = typeof body.description === 'string' ? body.description.trim().slice(0,900):'';
  const imageUrl = validImageUrl(body.imageUrl);
  const active = body.active === true ? 1 : 0;
  const sortOrder = Number(body.sortOrder ?? 100);
  const priceCents = body.priceCents === null || body.priceCents === '' || body.priceCents === undefined
    ? null : Number(body.priceCents);
  const items = Array.isArray(body.items) ? body.items : [];
  if (name.length < 2 || name.length > 110) throw new Error('INVALID_PACKAGE_NAME');
  if (!Number.isInteger(sortOrder) || sortOrder<0 || sortOrder>100000) throw new Error('INVALID_SORT_ORDER');
  if (priceCents !== null && (!Number.isInteger(priceCents) || priceCents<0 || priceCents>100000000)) throw new Error('INVALID_PRICE');
  if (items.length>30 || (active && !items.length)) throw new Error('INVALID_PACKAGE_ITEMS');
  const normalized = items.map(entry=>({
    productId:typeof entry.productId === 'string' ? entry.productId.slice(0,120):'',
    quantity:Number(entry.quantity)
  }));
  if (normalized.some(i=>!i.productId || !Number.isInteger(i.quantity) || i.quantity<1 || i.quantity>1000000)
      || new Set(normalized.map(x=>x.productId)).size!==normalized.length) throw new Error('INVALID_PACKAGE_ITEMS');
  return {name,description,imageUrl,active,sortOrder,priceCents,items:normalized};
}

async function validateItems(db,pkg) {
  if (!pkg.items.length) return;
  const productRows=await db.prepare('SELECT id,quantity_owned,active FROM products').all();
  const products=new Map((productRows.results||[]).map(p=>[p.id,p]));
  for(const item of pkg.items) {
    const product=products.get(item.productId);
    if (!product) throw new Error('INVALID_PACKAGE_ITEMS');
    if (pkg.active && !Number(product.active)) {
      throw new Error('PACKAGE_INVENTORY_UNAVAILABLE');
    }
  }
}

function failure(err) {
  const code=String(err?.message||'');
  if (['INVALID_IMAGE','INVALID_PACKAGE_NAME','INVALID_SORT_ORDER','INVALID_PRICE','INVALID_PACKAGE_ITEMS','PACKAGE_INVENTORY_UNAVAILABLE'].includes(code)) {
    return json({ok:false,error:{code,message:({
      INVALID_IMAGE:'Enter a valid HTTPS image URL or a site asset URL beginning with /assets/.',
      INVALID_PACKAGE_NAME:'Enter a package name.',
      INVALID_SORT_ORDER:'Enter a valid display order.',
      INVALID_PRICE:'Enter a valid price or leave blank.',
      INVALID_PACKAGE_ITEMS:'Select valid rental items and quantities for the package.',
      PACKAGE_INVENTORY_UNAVAILABLE:'All included items must be active inventory products before publishing.'
    })[code]}},400);
  }
  return safeErrorResponse(err);
}

export async function onRequestGet(context) {
  try {
    await requireAdmin(context.env,context.request);
    await ensureStorefrontTables(context.env.DB);
    return json({ok:true,packages:await availablePackages(context.env.DB)});
  } catch(err){return safeErrorResponse(err);}
}

export async function onRequestPost(context) {
  try {
    protectMutation(context.request);
    const owner=await requireAdmin(context.env,context.request);
    const pkg=normalizePackage(await readJson(context.request));
    await ensureStorefrontTables(context.env.DB);
    await validateItems(context.env.DB,pkg);
    const id=randomId();
    await context.env.DB.prepare(
      'INSERT INTO storefront_packages(id,name,description,image_url,items_json,price_cents,sort_order,active) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)'
    ).bind(id,pkg.name,pkg.description,pkg.imageUrl,JSON.stringify(pkg.items),pkg.priceCents,pkg.sortOrder,pkg.active).run();
    return json({ok:true,id},201);
  } catch(err){return failure(err);}
}

export async function onRequestPatch(context) {
  try {
    protectMutation(context.request);
    await requireAdmin(context.env,context.request);
    const body=await readJson(context.request);
    const id=typeof body.id === 'string' ? body.id : '';
    if(!/^[a-f0-9-]{36}$/i.test(id))return json({ok:false,error:{message:'Invalid package ID.'}},400);
    const pkg=normalizePackage(body);
    await ensureStorefrontTables(context.env.DB);
    await validateItems(context.env.DB,pkg);
    const result=await context.env.DB.prepare(
      'UPDATE storefront_packages SET name=?1,description=?2,image_url=?3,items_json=?4,price_cents=?5,sort_order=?6,active=?7,updated_at=unixepoch() WHERE id=?8'
    ).bind(pkg.name,pkg.description,pkg.imageUrl,JSON.stringify(pkg.items),pkg.priceCents,pkg.sortOrder,pkg.active,id).run();
    if(!result.meta?.changes)return json({ok:false,error:{message:'Package not found.'}},404);
    return json({ok:true});
  }catch(err){return failure(err);}
}

export async function onRequestDelete(context){
  try{
    protectMutation(context.request);
    await requireAdmin(context.env,context.request);
    const body=await readJson(context.request);
    const id=typeof body.id==='string'?body.id:'';
    if(!/^[a-f0-9-]{36}$/i.test(id))return json({ok:false,error:{message:'Invalid package ID.'}},400);
    await ensureStorefrontTables(context.env.DB);
    const result=await context.env.DB.prepare('UPDATE storefront_packages SET active=0,updated_at=unixepoch() WHERE id=?1').bind(id).run();
    if(!result.meta?.changes)return json({ok:false,error:{message:'Package not found.'}},404);
    return json({ok:true});
  }catch(err){return safeErrorResponse(err);}
}
