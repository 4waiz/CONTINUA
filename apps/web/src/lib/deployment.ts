/**
 * What this build is, and what it can honestly offer.
 *
 * The CONTINUA engine is Python - FastAPI, numpy, scikit-learn - and does not
 * run at the edge. The public deployment is therefore a static build with no
 * engine behind it, and that is a *property of the deployment*, not a fault.
 *
 * Treating it as a fault was the bug: the public site showed an amber "engine
 * offline" strip on every page load, which reads as something being broken when
 * nothing is. In a public build the interface simply says it is a preview, and
 * points at where the runnable thing lives.
 */

/** Set at build time by `CONTINUA_STATIC=1 NEXT_PUBLIC_PUBLIC_PREVIEW=1`. */
export const IS_PUBLIC_PREVIEW = process.env.NEXT_PUBLIC_PUBLIC_PREVIEW === '1';

export const REPO_URL = 'https://github.com/4waiz/CONTINUA';
