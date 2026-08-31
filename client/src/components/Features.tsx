import { MessageSquare, BarChart3, Brain, Shield } from "lucide-react";

const features = [
  {
    icon: MessageSquare,
    title: "Natural Language to SQL",
    description: "Ask questions in plain English and watch them transform into precise SQL queries automatically.",
  },
  {
    icon: BarChart3,
    title: "Auto Charts",
    description: "Instantly visualize your data with beautiful, interactive charts generated from your queries.",
  },
  {
    icon: Brain,
    title: "AI Insights",
    description: "Get intelligent recommendations and discover hidden patterns in your data with AI-powered analysis.",
  },
  {
    icon: Shield,
    title: "Secure Data Sandbox",
    description: "Your data stays private and secure. All queries run in an isolated, encrypted environment.",
  },
];

const Features = () => {
  return (
    <section id="features" className="py-24 relative overflow-hidden">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16 animate-fade-in">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Powerful Features for <span className="gradient-text">Data Teams</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Everything you need to analyze, visualize, and understand your data without writing a single line of code.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <div
              key={index}
              className="glass-card animate-slide-up group rounded-2xl p-6 transition-all duration-300 hover:-translate-y-2 hover:[box-shadow:var(--shadow-elevated)]"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <feature.icon className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
              <p className="text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;
