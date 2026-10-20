import { useId, type FormEvent } from 'react';
import { ArrowRight, Link as LinkIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function ListingUrlEntry() {
  const id = useId();
  const navigate = useNavigate();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem(
      'listing',
    ) as HTMLInputElement;
    const value = input.value.trim();
    try {
      const url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        !url.hostname.includes('.')
      )
        throw new Error('Invalid URL');
      input.setCustomValidity('');
      navigate(`/check?${new URLSearchParams({ url: url.href })}`);
      window.scrollTo(0, 0);
    } catch {
      input.setCustomValidity(
        'Enter a complete property listing URL starting with https:// or http://.',
      );
      input.reportValidity();
    }
  }

  return (
    <div className="listing-entry">
      <form className="listing-entry-form" onSubmit={submit}>
        <label className="sr-only" htmlFor={id}>
          Property listing URL
        </label>
        <LinkIcon size={21} aria-hidden="true" />
        <input
          id={id}
          name="listing"
          type="url"
          required
          placeholder="Paste a property listing URL here..."
          autoComplete="url"
          onInput={(event) => event.currentTarget.setCustomValidity('')}
        />
        <button type="submit" aria-label="Continue with this listing">
          <ArrowRight size={23} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
