import { Database } from 'lucide-react';

/**
 * Brand marks as inline SVG.
 *
 * lucide-react removed its brand icons (Github, Linkedin) in v1, so these are
 * inlined rather than pulling in a second icon package for two glyphs.
 */
const GithubMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden focusable="false">
    <path d="M12 .5C5.73.5.75 5.48.75 11.75c0 4.96 3.22 9.16 7.69 10.65.56.1.77-.24.77-.54v-1.9c-3.13.68-3.79-1.51-3.79-1.51-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.29-5.13-1.25-5.13-5.57 0-1.23.44-2.24 1.16-3.03-.12-.28-.5-1.43.11-2.98 0 0 .94-.3 3.09 1.16a10.7 10.7 0 0 1 5.63 0c2.14-1.46 3.09-1.16 3.09-1.16.61 1.55.23 2.7.11 2.98.72.79 1.16 1.8 1.16 3.03 0 4.33-2.64 5.28-5.15 5.56.4.35.76 1.04.76 2.1v3.11c0 .3.2.65.78.54a11.26 11.26 0 0 0 7.68-10.65C23.25 5.48 18.27.5 12 .5Z" />
  </svg>
);

const LinkedinMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden focusable="false">
    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13Zm1.78 13.02H3.55V9h3.57v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z" />
  </svg>
);

const CREATORS = [
  {
    name: 'Sarthak Patel',
    linkedin: 'https://www.linkedin.com/in/sarthak-patel23/',
    github: 'https://github.com/Community-Programmer',
  },
  {
    name: 'Vedika Pande',
    linkedin: 'https://www.linkedin.com/in/vedika-pande/',
    github: 'https://github.com/VedikaPande',
  },
];

const Footer = () => (
  <footer className="border-border bg-surface/60 border-t py-10">
    <div className="container mx-auto px-4">
      <div className="flex flex-col items-center justify-between gap-8 md:flex-row">
        <div className="flex items-center gap-2">
          <div className="bg-primary/10 rounded-lg p-2">
            <Database className="text-primary h-5 w-5" />
          </div>
          <span className="text-lg font-bold">QueryBot</span>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
          {CREATORS.map(({ name, linkedin, github }) => (
            <div key={name} className="flex items-center gap-3">
              <div className="text-left">
                <p className="text-sm font-medium">{name}</p>
                <p className="text-muted-foreground text-xs">Developer</p>
              </div>
              <div className="flex gap-1">
                <a
                  href={linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${name} on LinkedIn`}
                  aria-label={`${name} on LinkedIn`}
                  className="bg-foreground/5 hover:bg-primary/10 hover:text-primary flex h-8 w-8 items-center justify-center rounded-md transition-colors"
                >
                  <LinkedinMark className="h-3.5 w-3.5" />
                </a>
                <a
                  href={github}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${name} on GitHub`}
                  aria-label={`${name} on GitHub`}
                  className="bg-foreground/5 hover:bg-primary/10 hover:text-primary flex h-8 w-8 items-center justify-center rounded-md transition-colors"
                >
                  <GithubMark className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-6 text-sm">
          <a href="#features" className="text-muted-foreground hover:text-primary transition-colors">
            Features
          </a>
          <a href="#workflow" className="text-muted-foreground hover:text-primary transition-colors">
            How it works
          </a>
        </div>
      </div>

      <div className="border-border text-muted-foreground mt-8 border-t pt-6 text-center text-xs">
        <p>© {new Date().getFullYear()} QueryBot · Turn your data into answers</p>
      </div>
    </div>
  </footer>
);

export default Footer;
