// What leaves your Mac, and what this page can see. Stated plainly, and matching the code.
type Props = { onDismiss: () => void }

export default function DataPrivacy({ onDismiss }: Props) {
  return (
    <section className="privacy" aria-labelledby="privacy-heading">
      <div className="notice-head">
        <h2 id="privacy-heading">Data privacy</h2>
        <button type="button" className="notice-dismiss" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <ul>
        <li>
          <strong>Your photos never leave your Mac.</strong> The command reads
          GPS coordinates, dates, and place names from your Photos library
          locally. Photo files themselves are not read or sent.
        </li>
        <li>
          <strong>This web page has no server.</strong> It cannot see your
          library or your trip unless you paste the YAML here or the command
          hands it over.
        </li>
        <li>
          <strong>The trip is handed over on your own machine only.</strong> The
          command serves it once on 127.0.0.1 with a one-use random token, and
          only this page's origin can read it. It then stops listening.
        </li>
        <li>
          <strong>Route lookups go to public services.</strong> Road and rail
          routes come from OSRM and BRouter; landmark and station names from
          Overpass. Coordinates are rounded to about 100 m. Nominatim receives
          only town names.
        </li>
        <li>
          <strong>Map images come from public services.</strong> OpenStreetMap
          map tiles and GitHub-hosted Natural Earth land data load in your
          browser.
        </li>
        <li>
          <strong>Nothing is saved on a server.</strong> A trip you open is kept
          in this browser's local storage, so a refresh keeps it. Use Close trip
          to clear it.
        </li>
      </ul>
    </section>
  )
}
