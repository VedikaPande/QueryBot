import { Upload, MessageCircle, TrendingUp } from "lucide-react";

const steps = [
  {
    icon: Upload,
    number: "01",
    title: "Upload",
    description: "Upload your CSV file or connect to your existing database in seconds.",
  },
  {
    icon: MessageCircle,
    number: "02",
    title: "Ask",
    description: "Type your questions in natural language - no SQL knowledge required.",
  },
  {
    icon: TrendingUp,
    number: "03",
    title: "Visualize",
    description: "Get instant results with beautiful charts, tables, or raw data exports.",
  },
];

const Workflow = () => {
  return (
    <section id="workflow" className="py-24 bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16 animate-fade-in">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            How <span className="gradient-text">Querybot</span> Works
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            From data to insights in three simple steps. No technical skills required.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 relative">
          {/* Connection Lines (Desktop) */}
          <div className="hidden md:block absolute top-24 left-0 right-0 h-0.5 bg-gradient-to-r from-primary via-accent to-primary opacity-20" />

          {steps.map((step, index) => (
            <div
              key={index}
              className="relative animate-slide-up"
              style={{ animationDelay: `${index * 150}ms` }}
            >
              <div className="glass-card rounded-2xl p-8 text-center transition-all duration-300 hover:-translate-y-2 hover:[box-shadow:var(--shadow-elevated)]">
                <div className="relative inline-flex items-center justify-center mb-6">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary to-accent opacity-20 rounded-full blur-xl" />
                  <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                    <step.icon className="w-10 h-10 text-white" />
                  </div>
                </div>

                <div className="text-6xl font-bold gradient-text mb-4">{step.number}</div>
                <h3 className="text-2xl font-semibold mb-3">{step.title}</h3>
                <p className="text-muted-foreground">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Workflow;
