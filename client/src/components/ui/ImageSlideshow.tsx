import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SlideshowImage {
  src: string;
  alt: string;
  title?: string;
}

interface ImageSlideshowProps {
  images: SlideshowImage[];
  autoPlay?: boolean;
  autoPlayInterval?: number;
  showDots?: boolean;
  showArrows?: boolean;
  showPlayPause?: boolean;
  pauseOnHover?: boolean;
  className?: string;
}

/**
 * Auto-advancing image carousel with keyboard, pointer and dot navigation.
 *
 * The progress bar is a CSS animation keyed to the slide rather than a timer, so
 * it costs no re-renders.
 */
const ImageSlideshow = ({
  images,
  autoPlay = true,
  autoPlayInterval = 4000,
  showDots = true,
  showArrows = true,
  showPlayPause = false,
  pauseOnHover = true,
  className,
}: ImageSlideshowProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const containerRef = useRef<HTMLDivElement>(null);

  const slideCount = images.length;
  const isAdvancing = isPlaying && slideCount > 1 && !(pauseOnHover && isHovered);

  const goTo = useCallback(
    (index: number) => {
      setCurrentIndex(((index % slideCount) + slideCount) % slideCount);
    },
    [slideCount]
  );

  const next = useCallback(() => goTo(currentIndex + 1), [goTo, currentIndex]);
  const previous = useCallback(() => goTo(currentIndex - 1), [goTo, currentIndex]);
  const togglePlayPause = useCallback(() => setIsPlaying((playing) => !playing), []);

  // Advance the slide.
  useEffect(() => {
    if (!isAdvancing) return;

    const timer = window.setInterval(() => {
      setCurrentIndex((index) => (index + 1) % slideCount);
    }, autoPlayInterval);

    return () => window.clearInterval(timer);
  }, [isAdvancing, autoPlayInterval, slideCount]);

  // Keyboard navigation, scoped to the carousel so arrow keys elsewhere on the
  // page are unaffected.
  useEffect(() => {
    const node = containerRef.current;
    if (!node || slideCount <= 1) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        previous();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        next();
      } else if (event.key === ' ') {
        event.preventDefault();
        togglePlayPause();
      }
    };

    node.addEventListener('keydown', handleKeyDown);
    return () => node.removeEventListener('keydown', handleKeyDown);
  }, [next, previous, togglePlayPause, slideCount]);

  if (slideCount === 0) {
    return null;
  }

  const firstImage = images[0];
  if (slideCount === 1 && firstImage) {
    return (
      <div className={cn('relative', className)}>
        <img src={firstImage.src} alt={firstImage.alt} className="h-auto w-full rounded-2xl" />
      </div>
    );
  }

  const activeImage = images[currentIndex];

  return (
    <div
      ref={containerRef}
      role="group"
      aria-roledescription="carousel"
      aria-label="Product screenshots"
      tabIndex={0}
      className={cn('relative outline-none', className)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
    >
      <div className="bg-muted relative overflow-hidden rounded-2xl">
        <div
          className="flex transition-transform duration-700 ease-in-out"
          style={{ transform: `translateX(-${currentIndex * 100}%)` }}
        >
          {images.map((image, index) => (
            <div
              key={image.src}
              className="relative w-full shrink-0"
              aria-hidden={index !== currentIndex}
            >
              <img
                src={image.src}
                alt={image.alt}
                className="h-auto w-full object-cover"
                loading={index === 0 ? 'eager' : 'lazy'}
              />
            </div>
          ))}
        </div>

        {showArrows && (
          <>
            <Button
              onClick={previous}
              size="icon"
              variant="secondary"
              aria-label="Previous slide"
              className={cn(
                'absolute top-1/2 left-4 -translate-y-1/2 shadow-md transition-opacity duration-300',
                isHovered ? 'opacity-100' : 'opacity-0'
              )}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              onClick={next}
              size="icon"
              variant="secondary"
              aria-label="Next slide"
              className={cn(
                'absolute top-1/2 right-4 -translate-y-1/2 shadow-md transition-opacity duration-300',
                isHovered ? 'opacity-100' : 'opacity-0'
              )}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        )}

        {/* Progress bar. The key restarts the CSS animation on each slide, so no
            JavaScript timer is needed to drive it. */}
        {isAdvancing && (
          <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-black/20">
            <div
              key={currentIndex}
              className="bg-primary h-full"
              style={{ animation: `slide-progress ${autoPlayInterval}ms linear forwards` }}
            />
          </div>
        )}

        <div className="absolute top-4 right-4 flex items-center gap-2">
          <span className="rounded-full bg-black/60 px-2 py-1 text-xs text-white tabular-nums">
            {currentIndex + 1} / {slideCount}
          </span>
          {showPlayPause && (
            <Button
              onClick={togglePlayPause}
              size="icon-sm"
              variant="secondary"
              aria-label={isPlaying ? 'Pause the slideshow' : 'Play the slideshow'}
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>

        {activeImage?.title && (
          <div className="absolute inset-x-4 bottom-4">
            <div className="glass-card rounded-lg px-4 py-2">
              <p className="text-foreground text-sm font-medium">{activeImage.title}</p>
            </div>
          </div>
        )}
      </div>

      {showDots && (
        <div className="mt-4 flex justify-center gap-2">
          {images.map((image, index) => (
            <button
              key={image.src}
              type="button"
              onClick={() => goTo(index)}
              aria-label={`Go to slide ${index + 1}`}
              aria-current={index === currentIndex}
              className={cn(
                'h-2 rounded-full transition-all',
                index === currentIndex ? 'bg-primary w-6' : 'bg-muted-foreground/40 w-2 hover:bg-muted-foreground/70'
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ImageSlideshow;
