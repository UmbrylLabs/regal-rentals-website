import { json, safeErrorResponse } from '../../_lib/http.js';
import { ensureStorefrontTables, availableProducts, availablePackages } from '../../_lib/storefront.js';

export async function onRequestGet(context) {
  try {
    await ensureStorefrontTables(context.env.DB);
    const [products, allPackages] = await Promise.all([
      availableProducts(context.env.DB), availablePackages(context.env.DB)
    ]);
    const ids = new Map(products.filter(p=>p.quantityOwned>0).map(p=>[p.id,p]));
    const packages = allPackages.filter(pkg=>pkg.active && pkg.items.length &&
      pkg.items.every(item=>ids.has(item.productId) && Number.isInteger(item.quantity) &&
        item.quantity>0 && item.quantity<=1000000)
    ).map(pkg=>({
      id:pkg.id,name:pkg.name,description:pkg.description,imageUrl:pkg.imageUrl,
      priceCents:pkg.priceCents,items:pkg.items,sortOrder:pkg.sortOrder
    }));
    return json({ok:true,products:products.filter(p=>p.quantityOwned>0),packages},200,{'Cache-Control':'no-store, max-age=0'});
  } catch(err) { return safeErrorResponse(err); }
}
