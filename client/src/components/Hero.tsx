import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import ImageSlideshow from "@/components/ui/ImageSlideshow";
import { Sparkles, Play, Database } from "lucide-react";
import { useAppSelector } from "@/hooks/redux";
import heroVisual1 from "@/assets/1.png";
import heroVisual2 from "@/assets/2.png";
import heroVisual3 from "@/assets/3.png";
import heroVisual4 from "@/assets/4.png";
import heroVisual5 from "@/assets/5.png";
import heroVisual6 from "@/assets/6.png";


const Hero = () => {
  // Get authentication state
  const { isAuthenticated } = useAppSelector((state) => state.auth);

  // Slideshow images data
  const heroImages = [
    {
      src: heroVisual1,
      alt: "QueryBot Dashboard - Data Upload",
      title: "Upload Your Data"
    },
    {
      src: heroVisual2,
      alt: "QueryBot Dashboard - Ask Questions",
      title: "Ask in Natural Language"
    },
    {
      src: heroVisual3,
      alt: "QueryBot Dashboard - Get Insights",
      title: "Get Instant Insights"
    },
    {
      src: heroVisual4,
      alt: "QueryBot Dashboard - Visualizations",
      title: "Beautiful Visualizations"
    },
    {
      src: heroVisual5,
      alt: "QueryBot Dashboard - Analytics",
      title: "Smart Analytics"
    },
    {
      src: heroVisual6,
      alt: "QueryBot Dashboard - Reports",
      title: "Detailed Reports"
    }
  ];

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      {/* Floating Background Shapes */}
      <div className="floating-shape w-96 h-96 bg-primary top-20 -left-48 animate-float" style={{ animationDelay: "0s" }} />
      <div className="floating-shape w-64 h-64 bg-accent top-40 -right-32 animate-float" style={{ animationDelay: "2s" }} />
      <div className="floating-shape w-80 h-80 bg-primary/50 bottom-20 left-1/4 animate-float" style={{ animationDelay: "4s" }} />

      <div className="container mx-auto px-4 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left Content */}
          <div className="text-center lg:text-left animate-fade-in">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card mb-6">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">AI-Powered Data Intelligence</span>
            </div>

            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
              Ask Your Data{" "}
              <span className="gradient-text">Get Instant Insights</span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto lg:mx-0">
              Upload data or connect a database and ask questions in English to get charts, SQL, or insights instantly.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              {isAuthenticated ? (
                <Link to="/playground">
                  <Button className="btn-hero text-lg group">
                    Open Playground
                    <Play className="ml-2 w-5 h-5 group-hover:scale-110 transition-transform" />
                  </Button>
                </Link>
              ) : (
                <>
                  <Link to="/playground">
                    <Button className="btn-hero text-lg group">
                      Try QueryBot
                      <Database className="ml-2 w-5 h-5 group-hover:rotate-12 transition-transform" />
                    </Button>
                  </Link>
                  <Link to="/auth">
                    <Button className="btn-outline-hero text-lg">
                      Sign Up Free
                    </Button>
                  </Link>
                </>
              )}
            </div>

            <div className="mt-8 flex items-center gap-8 justify-center lg:justify-start text-sm text-muted-foreground">
              {isAuthenticated ? (
                <>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span>Upload your data and start querying</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span>Generate charts instantly</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span>No credit card required</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span>Free forever plan</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right Visual */}
          <div className="animate-scale-in group relative">
            <div
              className="glass-card overflow-hidden rounded-2xl"
              style={{ boxShadow: 'var(--shadow-elevated)' }}
            >
              <ImageSlideshow
                images={heroImages}
                autoPlay={true}
                autoPlayInterval={4500}
                showDots={true}
                showArrows={true}
                showPlayPause={true}
                pauseOnHover={true}
                className="w-full"
              />
            </div>

            {/* Floating Cards */}
            <div className="absolute -top-4 -left-4 glass-card p-4 rounded-xl animate-float" style={{ animationDelay: "1s" }}>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-primary" />
                <span className="text-sm font-medium">SQL Generated</span>
              </div>
            </div>

            <div className="absolute -bottom-4 -right-4 glass-card p-4 rounded-xl animate-float" style={{ animationDelay: "3s" }}>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-accent" />
                <span className="text-sm font-medium">Chart Created</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
