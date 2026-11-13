import { Component, type ErrorInfo, type ReactNode } from "react";

/** Isole une page : une erreur d'affichage ne vide plus toute l'application. */
export class ErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Journal local uniquement (aucun envoi reseau).
    console.error("Erreur d'affichage NEX", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="error-panel" role="alert">
          <strong>Cette page a rencontré une erreur d'affichage</strong>
          <p>{this.state.error.message}</p>
          <div>
            <button
              className="btn btn-sm"
              onClick={() => {
                this.setState({ error: null });
                this.props.onReset?.();
              }}
            >
              Recharger la page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
