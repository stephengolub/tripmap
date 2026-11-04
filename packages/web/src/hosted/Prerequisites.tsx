// What the user needs before the hosted command works. Shown at the top of the hosted page.
// Spaces next to <code> are explicit ({' '}): JSX drops whitespace at a line break.
type Props = { onDismiss: () => void }

export default function Prerequisites({ onDismiss }: Props) {
  return (
    <section className="prereqs" aria-labelledby="prereqs-heading">
      <div className="notice-head">
        <h2 id="prereqs-heading">Before you start</h2>
        <button type="button" className="notice-dismiss" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <ul>
        <li>
          <strong>Node.js 22.5 or newer, with npx.</strong> Run{' '}
          <code>node --version</code> in Terminal. If it is missing or older,
          install it from{' '}
          <a href="https://nodejs.org/" target="_blank" rel="noreferrer">
            nodejs.org
          </a>
          . The <code>npx</code> command comes with it.
        </li>
        <li>
          <strong>
            Run the command on the Mac that has your Photos library.
          </strong>{' '}
          The command reads Photos locally; this web page cannot.
        </li>
        <li>
          <strong>Give your terminal app Full Disk Access.</strong> System
          Settings &gt; Privacy &amp; Security &gt; Full Disk Access. Quit and
          reopen the terminal afterwards.
        </li>
        <li>
          <strong>Allow local network access in Chrome if asked.</strong> The
          page picks up the result from your terminal over 127.0.0.1. You can
          also paste the YAML instead.
        </li>
      </ul>
    </section>
  )
}
