import { signOut, type Account as AccountT } from '../lib/auth';

/** Header control: who is signed in, and a way to sign out (back to the login page). */
export function Account({ account }: { account: AccountT }) {
  return (
    <div className="account">
      {account.photo && <img className="avatar-img" src={account.photo} alt="" referrerPolicy="no-referrer" />}
      <span className="small">{account.name ?? account.email}</span>
      <button className="secondary small" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}
