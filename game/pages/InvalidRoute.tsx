// Useful fallback for unknown case / level / team paths. Never bounces to the intro.
import { useLocation, useNavigate } from 'react-router-dom';
import { CASES, getCase, parseId } from '../data/cases';
import { paths } from '../orchestration/routes';

export function InvalidRoute() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const m = /^\/team\/case\/([^/]+)(?:\/level\/([^/]+))?/.exec(pathname);
  let title = 'Nothing filed here';
  let body = 'This address does not lead anywhere in the investigation.';
  let caseId: number | null = null;
  if (m) {
    caseId = parseId(m[1]);
    if (caseId == null || !getCase(caseId)) {
      title = 'No such case file';
      body = `There is no case “${m[1]}” on the desk. The investigation has ${CASES.length} files, numbered 1 to ${CASES.length}.`;
      caseId = null;
    } else {
      title = 'No such level';
      body = `Case ${String(caseId).padStart(2, '0')} holds four pieces of evidence, levels 1 to 4. “${m[2]}” is not one of them.`;
    }
  }
  return (
    <div className="fallback" role="alert">
      <div className="fallback__card">
        <div className="kicker">Records office</div>
        <h1>{title}</h1>
        <p>{body}</p>
        <div className="fallback__actions">
          {caseId != null && <button type="button" className="btn" onClick={() => navigate(paths.case(caseId!))}>Open Case {String(caseId).padStart(2, '0')}</button>}
          <button type="button" className="btn btn--primary" onClick={() => navigate(paths.desk)}>Back to Desk</button>
        </div>
      </div>
    </div>
  );
}
