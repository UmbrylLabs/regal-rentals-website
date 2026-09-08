import { catalogImageResponse } from '../../../_lib/catalog-images.js';
import { safeErrorResponse } from '../../../_lib/http.js';
export async function onRequestGet(context) {
  try { return await catalogImageResponse(context); }
  catch (error) { return safeErrorResponse(error); }
}
